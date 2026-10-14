/**
 * REQ-072 — Raphael, 2026-10-14, on prod's login sitting on "…" for 22–31 s: "yeah fire and
 * forget." The lead capture the REQ-060 send-otp makes on the CRM (Quickbase behind it, 10 s per
 * 429) is started after the code goes out and never awaited: the reply comes back at once, and
 * the capture still reaches the CRM.
 *
 * The in-process app (UsersModule) against a stub CRM on localhost that holds the customers POST
 * for 2.5 s. The real CrmPaymentsLink is selected by PPWK_PAYMENTS_URL + PPWK_PAYMENTS_TOKEN
 * (payments-link-select); SMS stays in dev mode (no TWILIO_ACCOUNT_SID), so nothing leaves the box.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9072;
const CRM_HOLD_MS = 2500;

Deno.test("REQ-072 send-otp answers before the CRM capture finishes, and the capture still reaches the CRM", async () => {
  const seen: { path: string; phone: string; at: number }[] = [];
  let release: () => void = () => {};
  const captured = new Promise<void>((r) => (release = r));
  // the stub CRM: every customers POST is held CRM_HOLD_MS, as Quickbase's 429 waits hold the real one
  const crm = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    const path = new URL(req.url).pathname;
    const body = req.method === "POST" ? await req.json() : {};
    seen.push({ path, phone: body.customerPhone ?? "", at: Date.now() });
    await new Promise((r) => setTimeout(r, CRM_HOLD_MS));
    release();
    return Response.json({ customerId: "c-lead-1" }, { status: 201 });
  });
  const env = ["PPWK_PAYMENTS_URL", "PPWK_PAYMENTS_TOKEN", "PPWK_PAYMENTS_ACCOUNT", "TWILIO_ACCOUNT_SID", "KV_PATH"].map((k) => [k, Deno.env.get(k)] as const);
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.set("PPWK_PAYMENTS_URL", `http://127.0.0.1:${crm.addr.port}`);
  Deno.env.set("PPWK_PAYMENTS_TOKEN", "test-token");
  Deno.env.set("PPWK_PAYMENTS_ACCOUNT", "primary");
  Deno.env.delete("TWILIO_ACCOUNT_SID");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const t0 = Date.now();
    const res = await fetch(`http://localhost:${PORT}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: "+15125550072", language: "en" }),
    });
    const body = await res.json();
    const elapsed = Date.now() - t0;
    assertEquals(body, { sent: true });
    assert(elapsed < 1000, `send-otp answered in ${elapsed}ms — it waited on the CRM (held ${CRM_HOLD_MS}ms)`);
    // the capture still happens: the stub has the phone, and the held call completes after the reply
    await captured;
    assertEquals(seen.map((s) => [s.path, s.phone]), [["/api/payments/customers", "+15125550072"]]);
    assert(seen[0].at - t0 < 1000, "the capture was started with the send, not after the reply");
  } finally {
    await server.stop();
    await crm.shutdown();
    for (const [k, v] of env) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    await resetKv();
  }
});
