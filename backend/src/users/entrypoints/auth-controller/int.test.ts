/**
 * REQ-072 — Raphael, 2026-10-14, on prod's login sitting on "…" for 22–31 s: "yeah fire and
 * forget. … it passes it to the backend and it does not block the user. it MUST be guaranteed to
 * go in the crm this is mission critical." The lead capture the REQ-060 send-otp makes on the CRM
 * (Quickbase behind it, 10 s per 429) is an outbox record before the reply and is carried by the
 * sweep after it: the reply comes back while the CRM still holds the capture, the capture reaches
 * the CRM, and the record is cleared only on the CRM's answer.
 *
 * The in-process app (UsersModule) with its CRM door (the DI'd PaymentsLink) given a stub port
 * that holds the customers POST until the test lets it go — no env, no network: the real client's
 * selection is process-wide and the int lane runs files in parallel.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
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

const PORT = 9172;

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((
      _,
      reject,
    ) => (t = setTimeout(
      () => reject(new Error(`${what}: not within ${ms}ms`)),
      ms,
    ))),
  ]).finally(() => clearTimeout(t));
}

Deno.test("REQ-072 send-otp answers before the CRM capture finishes, and the capture still reaches the CRM", async () => {
  const seen: { phone: string }[] = [];
  let received: () => void = () => {};
  const receivedP = new Promise<void>((r) => (received = r));
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  // the stub CRM door: the customer create is held until the test lets it go — as Quickbase's 429 waits hold the real one
  const door = {
    async createCustomer(input: { customerPhone?: string }) {
      seen.push({ phone: input.customerPhone ?? "" });
      received();
      await held;
      return { customerId: "c-lead-1" };
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
  try {
    const res = await fetch(`http://localhost:${PORT}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: "+15125550072", language: "en" }),
    });
    const body = await res.json();
    assertEquals(
      body.sent,
      true,
      "the reply came while the CRM still holds the capture",
    );
    // the capture still happens, and the reply did not wait for it: the CRM is holding it now
    await timeout(receivedP, 5000, "the capture reaching the CRM");
    assertEquals(seen, [{ phone: "+15125550072" }]);
    const outbox = new CrmCaptureOutbox();
    assertEquals(
      (await outbox.list()).map((r) => r.phone),
      ["+15125550072"],
      "pending in KV until the CRM answers",
    );
    release();
    // and once the CRM answers, the record is cleared — the capture is done, not pending
    const t0 = Date.now();
    while ((await outbox.list()).length > 0 && Date.now() - t0 < 5000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assertEquals(await outbox.list(), [], "landed → cleared");
  } finally {
    await app.close();
    twilio === undefined
      ? Deno.env.delete("TWILIO_ACCOUNT_SID")
      : Deno.env.set("TWILIO_ACCOUNT_SID", twilio);
    await resetKv();
  }
});

/**
 * REQ-082 — Raphael, 2026-10-16: "for the fake you should have a pop up with the code." On the
 * fakes (DENO_DEPLOY unset — the int lane, a dev box, a pin) the send-otp reply carries the code
 * it stored, so the page can show it; and it is the real code: it verifies.
 */
Deno.test("REQ-082 send-otp answers with the dev code on the fakes, and that code verifies", async () => {
  const door = {
    createCustomer(_input: { customerPhone?: string }) {
      return Promise.resolve({ customerId: "c-lead-2" });
    },
  } as unknown as PaymentsLinkPort;
  const twilio = Deno.env.get("TWILIO_ACCOUNT_SID");
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID"); // SMS in dev mode: nothing leaves the box
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  app.get(PaymentsLink).portOverride = door;
  await app.listen(PORT + 1);
  try {
    const phone = "+15125550082";
    const res = await fetch(`http://localhost:${PORT + 1}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone, language: "es" }),
    });
    const body = await res.json();
    assertEquals(body.sent, true, `status ${res.status}: ${JSON.stringify(body)}`);
    assertEquals(
      typeof body.devCode,
      "string",
      "the code rides the reply on the fakes",
    );
    assertEquals(
      /^\d{6}$/.test(body.devCode),
      true,
      `six digits (${body.devCode})`,
    );
    const verified = await fetch(`http://localhost:${PORT + 1}/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone, code: body.devCode }),
    });
    const v = await verified.json();
    assertEquals(verified.status, 200, JSON.stringify(v));
    assertEquals(v.ok, true, "the dev code is the stored code");
  } finally {
    await app.close();
    twilio === undefined
      ? Deno.env.delete("TWILIO_ACCOUNT_SID")
      : Deno.env.set("TWILIO_ACCOUNT_SID", twilio);
    await resetKv();
  }
});
