/**
 * REQ-1149 (LOOP-007 cycle 3, q3-80; extends REQ-331 to POST /customers) — QA made a second
 * "Lupe Garza" through the API and nothing warned. POST /customers called store.create with no
 * lookup. Now a create that `findExistingCustomer` (shared/quote-flow/customer-dedupe.ts) matches
 * — same phone, same email, or the whole name accent- and case-blind — is refused with 409
 * `customer.possibleDuplicate` naming the existing customer, and nothing is saved; the same body
 * with `allowDuplicate: true` (the form's "Create anyway") makes the second customer.
 *
 * Integration over HTTP, app booted, KV :memory:.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CrmModule } from "@crm/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, CrmModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

async function login(phone: string): Promise<string> {
  const sent = await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  });
  await sent.body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-1149 (LOOP-007 q3, q3-80): POST /customers with a name she already has is 409 customer.possibleDuplicate and saves nothing; allowDuplicate makes the second one", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125558049");
    const headers = { "content-type": "application/json", "x-session-id": sid };
    const post = (body: unknown) =>
      fetch(`${BASE}/customers`, { method: "POST", headers, body: JSON.stringify(body) });

    const first = await post({ name: "Lupe Garza" });
    assertEquals(first.status, 200, "the first Lupe Garza is created");
    const lupe = await first.json();

    // accent/case-blind whole name, like REQ-331's chat form check
    const dup = await post({ name: "lupe  GARZA" });
    const dupBody = await dup.text();
    assertEquals(
      dup.status,
      409,
      `a second same-name customer is refused as a possible duplicate (got ${dup.status} ${dupBody})`,
    );
    assert(
      dupBody.includes("customer.possibleDuplicate"),
      `the refusal carries the key customer.possibleDuplicate (got ${dupBody})`,
    );
    assert(dupBody.includes(lupe.id), `the refusal names the existing customer's id (got ${dupBody})`);

    const listed = await fetch(`${BASE}/customers`, { headers }).then((r) => r.json());
    assertEquals(listed.length, 1, "nothing was saved on the refusal");

    const anyway = await post({ name: "Lupe Garza", allowDuplicate: true });
    assertEquals(anyway.status, 200, "Create anyway (allowDuplicate) makes the second customer");
    const second = await anyway.json();
    assert(second.id && second.id !== lupe.id, "a new customer, not the old one");
    assertEquals("allowDuplicate" in second, false, "the flag is not stored on the customer");

    const after = await fetch(`${BASE}/customers`, { headers }).then((r) => r.json());
    assertEquals(after.length, 2);
  } finally {
    await server.stop();
    await resetKv();
  }
});
