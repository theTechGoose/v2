/**
 * REQ-610 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 4, issue m51: the client's quote showed the business address
 * as just "FL" — onboarding's state step saved an address holding only the
 * state, and the public projection flattened it into the address line.
 *
 * Integration over HTTP, app booted: an owner whose saved address is only a
 * state gets no address line on the public quote (the state itself is still
 * carried for state-specific terms), and a real street + city still shows.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule, AgentsModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

async function login(phone: string): Promise<string> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-610 m51: a state-only business address puts no address line on the public quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125552751");
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await (await fetch(`${BASE}/profile/identity`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ businessName: "Ramirez Landscaping" }),
    })).body?.cancel();
    // exactly what the /welcome state step sends
    await (await fetch(`${BASE}/profile/address`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ state: "FL" }),
    })).body?.cancel();
    const made = await fetch(`${BASE}/agents/conversations/sample-quote`, {
      method: "POST",
      headers: auth,
      body: "{}",
    }).then((r) => r.json());

    const pub = await fetch(`${BASE}/quotes/${made.quoteId}/public`).then((r) =>
      r.json()
    );
    assertEquals(pub.contractor?.businessName, "Ramirez Landscaping");
    assertEquals(pub.contractor?.addressLine, undefined);
    assertEquals(pub.contractor?.state, "FL");

    // once the owner completes the address, it shows
    await (await fetch(`${BASE}/profile/address`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        state: "FL",
        street: "12 Palm Ave",
        city: "Tampa",
      }),
    })).body?.cancel();
    const after = await fetch(`${BASE}/quotes/${made.quoteId}/public`).then((
      r,
    ) => r.json());
    assertEquals(after.contractor?.addressLine, "12 Palm Ave, Tampa, FL");
  } finally {
    await server.stop();
    await resetKv();
  }
});
