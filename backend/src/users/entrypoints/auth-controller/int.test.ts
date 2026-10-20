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
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { DanetApplication, Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import {
  PaymentsLink,
  type PaymentsLinkPort,
} from "@users/domain/data/payments-link/mod.ts";
import { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { SignupNotice } from "@users/domain/coordinators/signup-notice/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import type { SendEmailInput } from "@communication/domain/data/email-service/mod.ts";

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

/**
 * REQ-098 — Raphael, 2026-10-20, on prod's sign-up sitting after the code: "i think it has to do
 * with the crm logic to capture the lead being synchronous, it should fire the event to the
 * backend and forget about it while the backend finishes the request." The customer sync a new
 * account makes on the CRM (REQ-058) was awaited before verify-otp replied — the CRM app's cold
 * start, its ledger account and its Quickbase calls, with no timeout anywhere. It is an outbox
 * record now, carried by the sweep after the reply, exactly as REQ-072's lead.
 */
Deno.test("REQ-098 verify-otp for a new account answers before the CRM has made its customer, and the customer still reaches the CRM", async () => {
  const seen: { phone: string; ref: string }[] = [];
  let received: () => void = () => {};
  const receivedP = new Promise<void>((r) => (received = r));
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  // the stub CRM door: the lead capture (no ref, REQ-072) answers at once; the account's customer
  // (with its ref) is held until the test lets it go — as the CRM app's cold start holds the real one
  const door = {
    async createCustomer(input: { customerPhone?: string; externalRef?: string }) {
      const ref = input.externalRef ?? "";
      seen.push({ phone: input.customerPhone ?? "", ref });
      if (ref === "") return { customerId: "c-lead-3" };
      received();
      await held;
      return { customerId: "c-user-3" };
    },
  } as unknown as PaymentsLinkPort;
  const twilio = Deno.env.get("TWILIO_ACCOUNT_SID");
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID"); // SMS in dev mode: nothing leaves the box
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  app.get(PaymentsLink).portOverride = door;
  await app.listen(PORT + 2);
  try {
    const phone = "+15125550098";
    const sent = await (await fetch(`http://localhost:${PORT + 2}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone, language: "es" }),
    })).json();
    assertEquals(sent.sent, true, JSON.stringify(sent));
    const t0 = Date.now();
    const verified = await timeout(
      fetch(`http://localhost:${PORT + 2}/auth/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber: phone, code: sent.devCode }),
      }),
      5000,
      "the verify reply while the CRM holds the customer",
    );
    const v = await verified.json();
    assertEquals(verified.status, 200, JSON.stringify(v));
    assertEquals(
      [v.isNewUser, typeof v.sessionId, typeof v.redirectTo],
      [true, "string", "string"],
      "a new account, signed in, sent on",
    );
    assert(Date.now() - t0 < 3000, `the reply did not wait for the CRM (${Date.now() - t0} ms)`);
    // the customer still happens, after the reply: the CRM is holding it now
    await timeout(receivedP, 5000, "the customer reaching the CRM");
    assertEquals(
      seen.filter((s) => s.ref !== "").map((s) => s.phone),
      [phone],
      "the account's customer, once, with its phone",
    );
    const outbox = new CrmCaptureOutbox();
    assertEquals(
      (await outbox.list()).filter((r) => r.userId && !r.kind).map((r) => r.userId),
      [v.userId],
      "the sync is pending in KV until the CRM answers (the notice is REQ-103's record)",
    );
    release();
    const t1 = Date.now();
    while ((await outbox.list()).length > 0 && Date.now() - t1 < 5000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assertEquals(await outbox.list(), [], "landed → cleared");
  } finally {
    release();
    await app.close();
    twilio === undefined
      ? Deno.env.delete("TWILIO_ACCOUNT_SID")
      : Deno.env.set("TWILIO_ACCOUNT_SID", twilio);
    await resetKv();
  }
});

// REQ-103 — Raphael, 2026-10-20: "if somone signs up we need to generate an email to
// hello@documonster.com." Every sign-up site enqueues the notice next to the CRM customer
// (REQ-098) and the sweep mails it after the reply. The CRM door answers at once here (REQ-098 is
// its own test); the mail is held until the test lets it go — as Postmark's wire holds the real one.
Deno.test("REQ-103 a sign-up — by phone on /auth/verify-otp and /auth/verify, by email, by start-fresh — answers at once, and the email to hello@documonster.com goes out after the reply with the account on it; a sign-in to an existing account sends none", async () => {
  const door = { createCustomer: () => Promise.resolve({ customerId: "c-103" }) } as unknown as PaymentsLinkPort;
  const mails: SendEmailInput[] = [];
  let received: () => void = () => {};
  const receivedP = new Promise<void>((r) => (received = r));
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  let hold = true;
  const twilio = Deno.env.get("TWILIO_ACCOUNT_SID");
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("TWILIO_ACCOUNT_SID"); // SMS in dev mode: nothing leaves the box
  await resetKv();
  const app = new DanetApplication();
  await app.init(TestApp);
  app.get(PaymentsLink).portOverride = door;
  app.get(SignupNotice).email = {
    async send(input: SendEmailInput) {
      mails.push(input);
      if (hold) {
        received();
        await held;
      }
      return { ok: true, messageId: `m-${mails.length}` };
    },
  };
  // the real deploy's side of REQ-318's switch: Postmark (the stub above) is reached; on the fakes
  // (every other app in this file) the notice is logged and nothing leaves the box
  app.get(SignupNotice).env = { get: (k: string) => (k === "DENO_DEPLOY" ? "true" : undefined) };
  await app.listen(PORT + 3);
  const base = `http://localhost:${PORT + 3}`;
  const json = { "content-type": "application/json" };
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: json, body: JSON.stringify(body) });
  const outbox = new CrmCaptureOutbox();
  const settled = async () => {
    const t = Date.now();
    while ((await outbox.list()).length > 0 && Date.now() - t < 5000) await new Promise((r) => setTimeout(r, 20));
    assertEquals(await outbox.list(), [], "the outbox is clear");
  };
  try {
    // by phone, the code the page got — /auth/verify-otp — while Postmark holds the mail
    const phone = "+15125550103";
    const sent = await (await post("/auth/send-otp", { phoneNumber: phone, language: "es" })).json();
    assertEquals(sent.sent, true, JSON.stringify(sent));
    const t0 = Date.now();
    const v = await (await timeout(post("/auth/verify-otp", { phoneNumber: phone, code: sent.devCode }), 5000, "the verify reply while the mail is held")).json();
    assertEquals(v.isNewUser, true, JSON.stringify(v));
    assert(Date.now() - t0 < 3000, `the reply did not wait for the mail (${Date.now() - t0} ms)`);
    await timeout(receivedP, 5000, "the notice reaching Postmark");
    assertEquals(mails.length, 1);
    assertEquals(mails[0].to, "hello@documonster.com");
    assertEquals(mails[0].subject, `New DocuMonster signup — ${phone}`);
    assertStringIncludes(mails[0].htmlBody, "by phone");
    assertStringIncludes(mails[0].htmlBody, `<strong>User ID:</strong> ${v.userId}`);
    assertEquals((await outbox.list()).filter((r) => r.kind === "signup-notice").map((r) => r.userId), [v.userId], "pending in KV until Postmark answers");
    hold = false;
    release();
    await settled();

    // the same account signs in again — /auth/verify with the master code: no mail
    const again = await (await post("/auth/verify", { phoneNumber: phone, code: "000000" })).json();
    assertEquals(again.isNewUser, false, JSON.stringify(again));
    await app.get(CrmLeadCapture).drain();
    assertEquals(mails.length, 1, "a sign-in is not a sign-up");

    // a new phone on /auth/verify, the other phone route
    const phone2 = "+15125550104";
    const v2 = await (await post("/auth/verify", { phoneNumber: phone2, code: "000000" })).json();
    assertEquals(v2.isNewUser, true, JSON.stringify(v2));
    await settled();
    assertEquals(mails.length, 2);
    assertEquals(mails[1].subject, `New DocuMonster signup — ${phone2}`);

    // by email — /auth/verify-email-otp (REQ-050), an address no account has yet
    const email = "ana.103@blackhole.postmarkapp.com";
    const v3 = await (await post("/auth/verify-email-otp", { email, code: "000000" })).json();
    assertEquals(v3.isNewUser, true, JSON.stringify(v3));
    await settled();
    assertEquals(mails.length, 3);
    assertEquals(mails[2].subject, `New DocuMonster signup — ${email}`);
    assertStringIncludes(mails[2].htmlBody, "by email");

    // start-fresh on a closed account (REQ-039): a new account on the number is a sign-up
    await app.get(UserStore).delete(v.userId);
    const closed = await (await post("/auth/verify", { phoneNumber: phone, code: "000000" })).json();
    assertEquals(closed.recoverable, true, JSON.stringify(closed));
    const v4 = await (await post("/auth/start-fresh", { token: closed.recoveryToken })).json();
    assertEquals(v4.isNewUser, true, JSON.stringify(v4));
    assert(v4.userId !== v.userId, "a new account, not the old one back");
    await settled();
    assertEquals(mails.length, 4);
    assertEquals(mails[3].subject, `New DocuMonster signup — ${phone}`);
    assertStringIncludes(mails[3].htmlBody, `<strong>User ID:</strong> ${v4.userId}`);
  } finally {
    hold = false;
    release();
    await app.close();
    twilio === undefined
      ? Deno.env.delete("TWILIO_ACCOUNT_SID")
      : Deno.env.set("TWILIO_ACCOUNT_SID", twilio);
    await resetKv();
  }
});
