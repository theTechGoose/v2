import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * REQ-260 — demo issue M24 over the booted app: "Suggested prices far too
 * low for a full bathroom gut ($1,450 / $1,750 / $2,100)" — under a $2,800
 * plumbing sub the contractor typed. POST /agents/job-details/prices takes
 * the ORIGINAL message (`raw`) plus the confirmed bullets (`scope`), and no
 * tier it answers is below a cost the contractor stated. Runs on the stub LLM
 * (its "(stub) …" echo is not JSON → the generic tiers), which is exactly the
 * case the floor must still hold for.
 */
@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9261;
const J = { "content-type": "application/json" };

async function withServer(fn: (base: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(`http://localhost:${PORT}`);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(
  base: string,
  phoneNumber = "+15125552600",
): Promise<string> {
  await (await fetch(`${base}/auth/send-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber }),
  }))
    .body?.cancel();
  const stored = await new OtpStore().get(phoneNumber);
  const v = await (await fetch(`${base}/auth/verify-otp`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ phoneNumber, code: stored!.code }),
  })).json();
  return v.sessionId;
}

const RAW =
  "Full gut of the hall bathroom. Demo to studs, cut the slab for a curbless shower — " +
  'my plumber quoted $2,800 for rough-in and finish. Frameless glass, 72" double vanity, permit included.';
const SCOPE =
  "Demolish bathroom to studs\nReroute drain for curbless shower\nInstall tile, vanity and glass";

Deno.test("REQ-260 M24 e2e: POST /agents/job-details/prices with {raw, scope} answers three ascending tiers, none below the $2,800 the contractor stated", async () => {
  await withServer(async (base) => {
    const sid = await login(base);
    const res = await fetch(`${base}/agents/job-details/prices`, {
      method: "POST",
      headers: { ...J, "x-session-id": sid },
      body: JSON.stringify({ raw: RAW, scope: SCOPE }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    const cents = (body.options as Array<{ priceCents: number }>).map((o) =>
      o.priceCents
    );
    assertEquals(cents.length, 3);
    for (const c of cents) {
      assert(c > 280000, `every tier above the stated $2,800: ${cents}`);
    }
    assert(cents[0] < cents[1] && cents[1] < cents[2], `ascending: ${cents}`);
    assertEquals(body.basis, "labor_and_materials");
  });
});
