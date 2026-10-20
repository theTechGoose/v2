/**
 * REQ-099 — Raphael, 2026-10-20, on prod after REQ-098 shipped: "now that otp shit works but every
 * fucking onboarding question makes me wait. why the FUCK would you patch that and not this?" The
 * wizard's saves — PUT /me (the name, the email), PUT /profile/identity (the business name, the
 * payment methods, the logo), POST /me/plan free, POST /me/onboarded — awaited the CRM customer
 * sync before replying: the same chain REQ-098 took off the sign-up (the CRM app's cold start, its
 * ledger account, its Quickbase calls, no timeout). They enqueue it now and reply at once; the
 * sweep carries the profile as last saved after the reply.
 *
 * The in-process app (UsersModule) with its CRM door given a stub port that holds every customer
 * write carrying this app's ref until the test lets it go — no env, no network.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import {
  PaymentsLink,
  type PaymentsLinkPort,
} from "@users/domain/data/payments-link/mod.ts";
import { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";

@Module({ imports: [UsersModule] })
class TestApp {}

const PORT = 9182;

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => (t = setTimeout(() => reject(new Error(`${what}: not within ${ms}ms`)), ms))),
  ]).finally(() => clearTimeout(t));
}

Deno.test("REQ-099 the wizard's saves — PUT /me, PUT /profile/identity, POST /me/plan free, POST /me/onboarded — reply before the CRM has taken the customer, and the CRM ends up with the profile as last saved", async () => {
  const seen: { customerName: string; contact?: string; tier?: string }[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  // the stub CRM door: the lead capture (no ref, REQ-072) answers at once; every customer write
  // carrying this app's ref is held until the test lets it go
  const door = {
    async createCustomer(input: { customerName: string; contact?: string; tier?: string; externalRef?: string }) {
      if (!input.externalRef) return { customerId: "c-lead-9" };
      seen.push({ customerName: input.customerName, contact: input.contact, tier: input.tier });
      await held;
      return { customerId: "c-user-9" };
    },
  } as unknown as PaymentsLinkPort;
  const twilio = Deno.env.get("TWILIO_ACCOUNT_SID");
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID"); // SMS in dev mode: nothing leaves the box
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  app.get(PaymentsLink).portOverride = door;
  await app.listen(PORT);
  const base = `http://localhost:${PORT}`;
  const json = { "content-type": "application/json" };
  try {
    const phone = "+15125550099";
    const sent = await (await fetch(`${base}/auth/send-otp`, { method: "POST", headers: json, body: JSON.stringify({ phoneNumber: phone, language: "es" }) })).json();
    assertEquals(sent.sent, true, JSON.stringify(sent));
    const v = await (await fetch(`${base}/auth/verify-otp`, { method: "POST", headers: json, body: JSON.stringify({ phoneNumber: phone, code: sent.devCode }) })).json();
    assertEquals(v.isNewUser, true, JSON.stringify(v));
    const h = { ...json, "x-session-id": v.sessionId };
    // the wizard's questions, answered one after another while the CRM holds the sign-up's write
    const saves: [string, string, string, unknown][] = [
      ["the name", "PUT", "/me", { name: "Ana" }],
      ["the business name", "PUT", "/profile/identity", { businessName: "Ana Roofing" }],
      ["the email", "PUT", "/me", { email: "ana@roof.test" }],
      ["the free plan", "POST", "/me/plan", { planId: "free" }],
      ["leaving the wizard", "POST", "/me/onboarded", {}],
    ];
    for (const [what, method, path, body] of saves) {
      const t0 = Date.now();
      const res = await timeout(
        fetch(`${base}${path}`, { method, headers: h, body: JSON.stringify(body) }),
        5000,
        `${what}: the reply while the CRM holds the customer`,
      );
      await res.body?.cancel();
      assertEquals(res.status, 200, `${what}: ${res.status}`);
      assert(Date.now() - t0 < 3000, `${what} did not wait for the CRM (${Date.now() - t0} ms)`);
    }
    assertEquals(seen.length, 1, "one customer write is on the CRM, held; the saves did not line up behind it");
    const outbox = new CrmCaptureOutbox();
    assertEquals((await outbox.list()).filter((r) => r.userId && !r.kind).map((r) => r.userId), [v.userId], "the account's sync is pending in KV, re-marked by the saves (the notice is REQ-103's record)");
    release();
    const t1 = Date.now();
    while ((await outbox.list()).length > 0 && Date.now() - t1 < 5000) await new Promise((r) => setTimeout(r, 20));
    assertEquals(await outbox.list(), [], "landed → cleared");
    const last = seen[seen.length - 1];
    assertEquals([last.customerName, last.contact, last.tier], ["Ana Roofing", "Ana", "Lead"], "the CRM ends up with the profile as last saved");
  } finally {
    release();
    await app.close();
    twilio === undefined ? Deno.env.delete("TWILIO_ACCOUNT_SID") : Deno.env.set("TWILIO_ACCOUNT_SID", twilio);
    await resetKv();
  }
});
