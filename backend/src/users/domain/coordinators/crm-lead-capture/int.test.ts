/**
 * REQ-072 — Raphael, 2026-10-14: "what i mean by fire and forget is that it passes it to the
 * backend and it does not block the user. it MUST be guaranteed to go in the crm this is mission
 * critical." A lead capture is a KV outbox record first; the sweep (every login, every boot, every
 * minute on Deploy's cron) carries it to the CRM and retries with backoff until the CRM says yes.
 * Nothing is dropped: a CRM that fails, hangs, or an isolate that dies after the reply all leave
 * the record for the next sweep.
 *
 * The sweep against a stub CRM door (the PaymentsLink port): no env, no network.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { getKv, kvCache, resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import { CrmLeadCapture } from "./mod.ts";
import { PayLinkMint } from "@users/domain/coordinators/pay-link-mint/mod.ts";
import { chosen } from "@users/domain/business/plan/mod.ts";
import { SignupNotice } from "@users/domain/coordinators/signup-notice/mod.ts";
import type { SendEmailInput, SendEmailResult } from "@communication/domain/data/email-service/mod.ts";

type Answer = { status: number } | "hang";
/** REQ-103 — Postmark as the sweep sees it, for the signup notice */
type MailAnswer = { ok: boolean; reason?: string } | "hang";

/** the CRM door as the sweep sees it: answers in order, then always yes. No env, no network — the
 *  real client's selection is env-wide and the int lane runs files in parallel. */
async function fresh(answers: Answer[], outbox = new CrmCaptureOutbox()) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const calls: { path: string; phone: string }[] = [];
  const link = {
    createCustomer(input: { customerPhone?: string }) {
      calls.push({ path: "/api/payments/customers", phone: input.customerPhone ?? "" });
      const a = answers.shift() ?? { status: 201 };
      if (a === "hang") return new Promise<{ customerId: string }>(() => {});
      if (a.status >= 400) return Promise.reject(new Error(`payments-unavailable: POST /api/payments/customers answered ${a.status}: {"error":"boom"}`));
      return Promise.resolve({ customerId: "c-lead" });
    },
  } as unknown as PaymentsLink;
  const users = new UserStore();
  const crm = new CrmCustomerSync(users, new BusinessIdentityStore(), link, new PlanStore());
  // REQ-103 — the signup notice's sender as the sweep sees it: answers in order, then always ok.
  // No env: the real one reads POSTMARK_API_KEY, process-wide, and the int lane runs files in parallel.
  const mails: SendEmailInput[] = [];
  const mailAnswers: MailAnswer[] = [];
  const notice = new SignupNotice(users);
  notice.email = {
    send(input: SendEmailInput): Promise<SendEmailResult> {
      mails.push(input);
      const a = mailAnswers.shift() ?? { ok: true };
      if (a === "hang") return new Promise<SendEmailResult>(() => {});
      return Promise.resolve(a.ok ? { ok: true, messageId: `m-${mails.length}` } : { ok: false, reason: a.reason });
    },
  };
  // the real deploy's side of REQ-318's switch: Postmark (the stub above) is reached. On the fakes
  // the notice is logged and never mailed (the test below).
  notice.env = { get: (k: string) => (k === "DENO_DEPLOY" ? "true" : undefined) };
  const make = () => new CrmLeadCapture(outbox, crm, notice, new PayLinkMint(new PlanStore(), link, crm)); // REQ-106 — the pay link rides this outbox too
  return { calls, outbox, make, users, mails, mailAnswers, notice };
}
async function done() {
  await resetKv();
}
/** the sweep enqueue() starts is not awaited by design: give it a few turns */
async function until(cond: () => boolean, ms = 2000) {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
}

Deno.test("REQ-072 a capture is a KV record before anything is sent, and the sweep carries it to the CRM and clears it", async () => {
  const { calls, outbox, make } = await fresh([]);
  const leads = make();
  await leads.enqueue("(512) 555-0072");
  assertEquals((await outbox.list()).map((r) => r.phone), ["+15125550072"], "pending in KV, normalized");
  const swept = await leads.drain();
  assertEquals(swept, { landed: 1, deferred: 0, waiting: 0 });
  assertEquals(calls, [{ path: "/api/payments/customers", phone: "+15125550072" }]);
  assertEquals(await outbox.list(), [], "landed → gone");
  await done();
});

Deno.test("REQ-072 a CRM that fails keeps the record, with its attempts and error, and a later sweep lands it", async () => {
  const { calls, outbox, make } = await fresh([{ status: 503 }, { status: 500 }]);
  const leads = make();
  await leads.enqueue("+15125550073");
  assertEquals(await leads.drain(), { landed: 0, deferred: 1, waiting: 0 });
  const [rec] = await outbox.list();
  assertEquals([rec.phone, rec.attempts], ["+15125550073", 1]);
  assert((rec.lastError ?? "").includes("503"), `the error is on the record: ${rec.lastError}`);
  assert(Date.parse(rec.nextAt) > Date.now(), "not due again at once — backoff");
  assertEquals(await leads.drain(), { landed: 0, deferred: 0, waiting: 1 }, "a sweep before its time leaves it alone");
  // its time comes (the clock is the sweep's argument)
  assertEquals(await leads.drain(Date.parse(rec.nextAt)), { landed: 0, deferred: 1, waiting: 0 });
  const [rec2] = await outbox.list();
  assertEquals(rec2.attempts, 2);
  assertEquals(await leads.drain(Date.parse(rec2.nextAt)), { landed: 1, deferred: 0, waiting: 0 });
  assertEquals(calls.length, 3);
  assertEquals(await outbox.list(), []);
  await done();
});

Deno.test("REQ-072 a record survives the process: a fresh sweep after a restart carries what the dead one left", async () => {
  const { calls, outbox, make } = await fresh([]);
  await outbox.add("+15125550074", Date.now()); // the request wrote it; the isolate died before any sweep
  const afterRestart = make();
  assertEquals(await afterRestart.drain(), { landed: 1, deferred: 0, waiting: 0 });
  assertEquals(calls.map((c) => c.phone), ["+15125550074"]);
  await done();
});

Deno.test("REQ-072 one sweep at a time per process, and a lease keeps two sweeps off the same record", async () => {
  const { calls, outbox, make } = await fresh([]);
  const leads = make();
  await leads.enqueue("+15125550075");
  const [a, b] = await Promise.all([leads.drain(), leads.drain()]);
  assertEquals([a, b], [{ landed: 1, deferred: 0, waiting: 0 }, { landed: 1, deferred: 0, waiting: 0 }], "the second call joins the first");
  assertEquals(calls.length, 1, "sent once");
  // another process's sweep: the record is leased by a sweep still running
  await outbox.add("+15125550076", Date.now());
  const [rec] = await outbox.list();
  assert(await outbox.claim(rec, Date.now()), "this process claims it");
  assertEquals(await make().drain(), { landed: 0, deferred: 0, waiting: 1 }, "the other sweep waits");
  await done();
});

Deno.test("REQ-072 enqueue twice for one phone is one record, and enqueue never waits on the CRM", async () => {
  const { calls, outbox, make } = await fresh(["hang"]);
  const leads = make();
  const t0 = Date.now();
  await leads.enqueue("+15125550077");
  await leads.enqueue("+15125550077");
  assert(Date.now() - t0 < 500, "enqueue returned at once while the CRM hangs");
  assertEquals((await outbox.list()).length, 1);
  await until(() => calls.length >= 1);
  assertEquals(calls.length, 1, "the hung attempt is in flight; nothing else was sent");
  await done();
});

Deno.test("REQ-073 a sweep over a KV that will not open resolves with the failure logged, and the next sweep opens KV again", async () => {
  // the real Deno.openKv on a path that cannot open, then on a path that can — a cache of this
  // test's own: the process's KV and KV_PATH are shared with every file the parallel lane runs
  let path = "/nonexistent-dir-req-073/kv.db";
  const own = kvCache((p) => Deno.openKv(p), () => path);
  class OwnKvOutbox extends CrmCaptureOutbox {
    protected override kv() {
      return own.get();
    }
  }
  const outbox = new OwnKvOutbox();
  const { calls, make } = await fresh([], outbox);
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  try {
    const leads = make();
    const result = await leads.drain(); // the boot sweep: it must come back, not reject
    assertEquals([result.landed, result.deferred, result.waiting], [0, 0, 0]);
    assert(result.failed, "the failure is named");
    assert(result.failed.includes("unable to open database file"), `the real open's words: ${result.failed}`);
    assertEquals(errors.length, 1, "and logged once");
    // KV is back (a bad open is not remembered): the same process sweeps for real
    path = ":memory:";
    await outbox.add("+15125550073", Date.now());
    assertEquals(await leads.drain(), { landed: 1, deferred: 0, waiting: 0 });
    assertEquals(calls.map((c) => c.phone), ["+15125550073"]);
  } finally {
    console.error = original;
    await own.reset();
    await done();
  }
});

Deno.test("REQ-074 a boot sweep and a login sweep still carry the outbox with no cron anywhere", async () => {
  const { calls, outbox, make } = await fresh([]);
  const deno = Deno as unknown as { cron?: unknown };
  const hadCron = Object.getOwnPropertyDescriptor(Deno, "cron");
  let cronCalls = 0;
  Object.defineProperty(Deno, "cron", { configurable: true, writable: true, value: () => ++cronCalls });
  try {
    // the boot: a record a dead isolate left behind, swept by the next process's boot sweep
    await outbox.add("+15125550074", Date.now() - 1000);
    const leads = make();
    assert(leads.registerSweep(), "the minute timer is set at boot");
    assertEquals(await leads.drain(), { landed: 1, deferred: 0, waiting: 0 });
    // the login: enqueue() sweeps without being awaited
    await leads.enqueue("+1 (512) 555-0075");
    await until(() => calls.length >= 2);
    assertEquals(calls.map((c) => c.phone), ["+15125550074", "+15125550075"]);
    assertEquals((await outbox.list()).length, 0);
    assertEquals(cronCalls, 0, "Deno.cron is never called");
  } finally {
    if (hadCron) Object.defineProperty(Deno, "cron", hadCron);
    else delete deno.cron;
    await done();
  }
});

/**
 * REQ-098 — Raphael, 2026-10-20, on prod's sign-up sitting after the code: "it should fire the
 * event to the backend and forget about it while the backend finishes the request." The account's
 * CRM customer (REQ-058's sync) is an outbox record too: enqueueSync is a KV write, the sweep makes
 * the customer through CrmCustomerSync.ensure, and the record is cleared on the CRM's answer.
 */
Deno.test("REQ-098 a customer sync is a KV record before anything is sent, enqueueSync never waits on the CRM, and the sweep makes the account's customer", async () => {
  const { calls, outbox, make } = await fresh(["hang"]);
  const user = await new UserStore().create({ phoneNumber: "+15125550098", language: "en" });
  const leads = make();
  const t0 = Date.now();
  await leads.enqueueSync(user.id);
  assert(Date.now() - t0 < 500, "enqueueSync returned at once while the CRM hangs");
  assertEquals((await outbox.list()).map((r) => r.userId), [user.id], "the sync is a record in KV");
  await until(() => calls.length >= 1);
  assertEquals(calls.map((c) => c.phone), ["+15125550098"], "the hung attempt is in flight, with the account's phone");
  await done();
});

Deno.test("REQ-098 a CRM that fails keeps the sync record with its attempts and error, and a later sweep makes the customer and clears it", async () => {
  const { calls, outbox, make } = await fresh([{ status: 503 }]);
  const user = await new UserStore().create({ phoneNumber: "+15125550097", language: "en" });
  const leads = make();
  await leads.enqueueSync(user.id);
  assertEquals(await leads.drain(), { landed: 0, deferred: 1, waiting: 0 });
  const [rec] = await outbox.list();
  assertEquals([rec.userId, rec.attempts], [user.id, 1]);
  assert((rec.lastError ?? "").includes("503"), `the error is on the record: ${rec.lastError}`);
  assertEquals(await leads.drain(Date.parse(rec.nextAt)), { landed: 1, deferred: 0, waiting: 0 });
  assertEquals(calls.map((c) => c.phone), ["+15125550097", "+15125550097"]);
  assertEquals(await outbox.list(), []);
  await done();
});

/**
 * REQ-099 — Raphael, 2026-10-20, on prod after REQ-098 shipped: "every fucking onboarding question
 * makes me wait." The wizard's saves enqueue the account's sync like the sign-up does — and a save
 * made while that sync is already in flight must not be lost to it: the record is re-marked, the
 * running sweep leaves it, the sweep that follows carries the newer profile.
 */
Deno.test("REQ-099 a save made while the account's sync is in flight is not lost: the record is re-marked, the sweep runs again after the first, and the CRM ends up with the newer profile", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const inputs: { contact?: string }[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  const link = {
    async createCustomer(input: { contact?: string }) {
      inputs.push({ contact: input.contact });
      if (inputs.length === 1) await held; // the first write sits on the CRM, as the CRM app's cold start holds the real one
      return { customerId: "c-99" };
    },
  } as unknown as PaymentsLink;
  const outbox = new CrmCaptureOutbox();
  const users = new UserStore();
  const crm = new CrmCustomerSync(users, new BusinessIdentityStore(), link, new PlanStore());
  const leads = new CrmLeadCapture(outbox, crm, {} as SignupNotice, {} as PayLinkMint); // no notice, no pay link is enqueued here
  const user = await users.create({ phoneNumber: "+15125550199", language: "en" });
  await leads.enqueueSync(user.id);
  await until(() => inputs.length >= 1);
  // the person types a name while the first write is held, and the wizard saves it
  await users.update(user.id, { name: "Ana" });
  await leads.enqueueSync(user.id);
  assertEquals((await outbox.list()).length, 1, "one record per account, re-marked");
  release();
  const t0 = Date.now();
  while ((await outbox.list()).length > 0 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 10));
  assertEquals(await outbox.list(), [], "cleared once the newer profile landed");
  assertEquals(inputs.map((i) => i.contact), [undefined, "Ana"], "the sweep that followed carried the name");
  await done();
});

// REQ-103 — Raphael, 2026-10-20: "if somone signs up we need to generate an email to
// hello@documonster.com." The notice is a KV record before the sign-up replies (the same outbox as
// the lead and the customer sync); the sweep mails it after, and a mail Postmark refused is retried.
Deno.test("REQ-103 a signup notice is a KV record before anything is sent, and enqueueSignupNotice never waits on the mail", async () => {
  const { outbox, make, users, mails, mailAnswers } = await fresh([]);
  mailAnswers.push("hang");
  const user = await users.create({ phoneNumber: "+15125550103", language: "es", name: "Nuevo usuario" });
  const leads = make();
  const t0 = Date.now();
  await leads.enqueueSignupNotice(user.id);
  assert(Date.now() - t0 < 500, "enqueue returned at once while Postmark hangs");
  const [rec] = (await outbox.list()).filter((r) => r.kind === "signup-notice");
  assertEquals([rec.userId, rec.attempts], [user.id, 0], "pending in KV, keyed as a signup notice");
  await until(() => mails.length >= 1);
  assertEquals(mails.length, 1, "the hung send is in flight; nothing else was sent");
  await leads.enqueueSignupNotice(user.id);
  assertEquals((await outbox.list()).filter((r) => r.kind === "signup-notice").length, 1, "enqueued twice is one record");
  await done();
});

Deno.test("REQ-103 the sweep mails hello@documonster.com with the account on it and clears the record; a mail Postmark refused keeps the record with its attempts and reason, and a later sweep mails it; an account wiped before its sweep is cleared with no mail", async () => {
  const { outbox, make, users, mails, mailAnswers } = await fresh([]);
  const user = await users.create({ phoneNumber: "+15125550104", language: "en", name: "New user" });
  await outbox.addSignupNotice(user.id, Date.now()); // the request wrote it; the isolate died before any sweep
  const leads = make();
  assertEquals(await leads.drain(), { landed: 1, deferred: 0, waiting: 0 });
  assertEquals(mails.length, 1);
  assertEquals(mails[0].to, "hello@documonster.com");
  assertEquals(mails[0].subject, "New DocuMonster signup — +15125550104");
  assertStringIncludes(mails[0].htmlBody, `<strong>User ID:</strong> ${user.id}`);
  assertStringIncludes(mails[0].htmlBody, `<strong>Signed up:</strong> ${user.createdAt}`);
  assertEquals(await outbox.list(), [], "mailed → gone");

  // Postmark refuses twice, then takes it
  const second = await users.create({ phoneNumber: "+15125550105", language: "es" });
  mailAnswers.push({ ok: false, reason: "postmark 503: down" }, { ok: false, reason: "postmark 500: boom" });
  await outbox.addSignupNotice(second.id, Date.now());
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => warned.push(args.map(String).join(" "));
  try {
    assertEquals(await leads.drain(), { landed: 0, deferred: 1, waiting: 0 });
    const [rec] = await outbox.list();
    assertEquals([rec.kind, rec.userId, rec.attempts], ["signup-notice", second.id, 1]);
    assertStringIncludes(rec.lastError ?? "", "postmark 503");
    assert(Date.parse(rec.nextAt) > Date.now(), "not due again at once — backoff");
    assertEquals(await leads.drain(), { landed: 0, deferred: 0, waiting: 1 }, "a sweep before its time leaves it alone");
    assertEquals(await leads.drain(Date.parse(rec.nextAt)), { landed: 0, deferred: 1, waiting: 0 });
    const [rec2] = await outbox.list();
    assertEquals([rec2.kind, rec2.attempts], ["signup-notice", 2]);
    assertEquals(await leads.drain(Date.parse(rec2.nextAt)), { landed: 1, deferred: 0, waiting: 0 });
    assertEquals(mails.length, 4, "three tries for the second account, one for the first");
    assertEquals(mails.at(-1)?.subject, "New DocuMonster signup — +15125550105");
    assertEquals(await outbox.list(), []);
    assertStringIncludes(warned[0] ?? "", "signup notice for");

    // wiped before the sweep got to it (GET /me/wipe hard-deletes): nothing to tell, the record clears
    const third = await users.create({ phoneNumber: "+15125550106" });
    await outbox.addSignupNotice(third.id, Date.now());
    await (await getKv()).delete(["user", third.id]);
    assertEquals(await leads.drain(), { landed: 1, deferred: 0, waiting: 0 });
    assertEquals(mails.length, 4, "no mail for an account that is gone");
    assertEquals(await outbox.list(), []);
    assertStringIncludes(warned.at(-1) ?? "", third.id);
  } finally {
    console.warn = warn;
  }
  await done();
});

// REQ-103 — found in the gate: the served backend runs with the primary's real Postmark key, and the
// two e2e runs mailed hello@documonster.com 70 times for the stories' fake sign-ups. REQ-318: on the
// fakes nothing leaves the box.
Deno.test("REQ-103 on the fakes (REQ-318: DENO_DEPLOY unset, not on Deno Deploy) the sweep logs the notice with its subject and clears it — Postmark is never reached", async () => {
  const { outbox, make, users, mails, notice } = await fresh([]);
  notice.env = { get: () => undefined };
  const user = await users.create({ phoneNumber: "+15125550107", language: "es" });
  await outbox.addSignupNotice(user.id, Date.now());
  const logged: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  try {
    assertEquals(await make().drain(), { landed: 1, deferred: 0, waiting: 0 });
  } finally {
    console.log = log;
  }
  assertEquals(mails, [], "no mail leaves the box");
  assertStringIncludes(logged.at(-1) ?? "", "[signup-notice] fakes: would mail hello@documonster.com — New DocuMonster signup — +15125550107");
  assertEquals(await outbox.list(), [], "counted as sent → gone");
  await done();
});

// ---- REQ-106 — the paid pick's CRM work rides this outbox -------------------------------------
// Raphael, 2026-10-20: "when i click a plan in the onboarding flow the payment link takes FOREVER
// to load … i dont care if it happens asyncronously … what i care about is that the user
// experience is good." The pick replies with a pending plan and a pay-link record; the sweep makes
// the customer, raises the due and mints the page (PayLinkMint) after the reply — the same three
// calls, in the same order, that the reply used to wait on.
type PayAnswer = { status: number } | "hang" | "ok";
/** the CRM's three doors as the sweep sees them: answers in order per door, then always yes */
async function freshPay(opts: { customer?: PayAnswer[]; due?: PayAnswer[]; link?: PayAnswer[] } = {}) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const calls: string[] = [];
  const answer = <T>(queue: PayAnswer[] | undefined, path: string, ok: T): Promise<T> => {
    calls.push(path);
    const a = queue?.shift() ?? "ok";
    if (a === "hang") return new Promise<T>(() => {});
    if (a !== "ok" && a.status >= 400) {
      const e = Object.assign(
        new Error(a.status === 422 ? "merchant-unknown: alpha is not an account on record" : `payments-unavailable: POST ${path} answered ${a.status}: {"error":"boom"}`),
        { status: a.status },
      );
      return Promise.reject(e);
    }
    return Promise.resolve(ok);
  };
  let minted = 0;
  const link = {
    createCustomer: (_input: unknown) => answer(opts.customer, "/api/payments/customers", { customerId: "c-106" }),
    raiseDue: (input: { amountCents: number }) => answer(opts.due, "/api/payments/dues", { dueId: `d-${input.amountCents}` }),
    mintPayLink: (input: { dueId: string; merchant: string }) => answer(opts.link, "/api/payments/pay-links", { payUrl: `http://crm/pay?due=${input.dueId}&account=${input.merchant}&n=${++minted}` }),
  } as unknown as PaymentsLink;
  const users = new UserStore();
  const plans = new PlanStore();
  const crm = new CrmCustomerSync(users, new BusinessIdentityStore(), link, plans);
  const outbox = new CrmCaptureOutbox();
  const leads = new CrmLeadCapture(outbox, crm, {} as SignupNotice, new PayLinkMint(plans, link, crm));
  const user = await users.create({ phoneNumber: "+15125551060", email: "h@roof.test", name: "Han" });
  await plans.put(chosen(user.id, "monster", new Date().toISOString(), { merchant: "primary" }));
  return { calls, outbox, leads, plans, user };
}

Deno.test("REQ-106 a pay link is a KV record before anything is sent: enqueuePayLink returns at once while the CRM hangs, and the record names the account's pick and the way back", async () => {
  const { calls, outbox, leads, user } = await freshPay({ customer: ["hang"] });
  const t0 = Date.now();
  await leads.enqueuePayLink(user.id, "/welcome");
  assert(Date.now() - t0 < 500, "enqueuePayLink returned at once while the CRM hangs");
  assertEquals((await outbox.list()).map((r) => [r.kind, r.userId, r.back]), [["pay-link", user.id, "/welcome"]], "the pay link is a record in KV, keyed apart from the sync");
  await until(() => calls.length >= 1);
  assertEquals(calls, ["/api/payments/customers"], "the hung attempt is in flight: the customer first");
  await done();
});

Deno.test("REQ-106 the sweep makes the customer, raises the due and mints the page in that order, writes the page on the plan and clears the record", async () => {
  const { calls, outbox, leads, plans, user } = await freshPay();
  await leads.enqueuePayLink(user.id, "/settings");
  await leads.drain();
  assertEquals(calls, ["/api/payments/customers", "/api/payments/dues", "/api/payments/pay-links"]);
  const plan = (await plans.get(user.id))!;
  assertEquals([plan.status, plan.customerId, plan.dueId, plan.payUrl, plan.payLinkError], ["pending", "c-106", "d-9900", "http://crm/pay?due=d-9900&account=primary&n=1", undefined]);
  assertEquals(await outbox.list(), []);
  await done();
});

Deno.test("REQ-106 a CRM that fails keeps the record with its attempts and error, the plan says payments-unavailable meanwhile, and a later sweep mints the page and clears both", async () => {
  const { calls, outbox, leads, plans, user } = await freshPay({ due: [{ status: 503 }] });
  await leads.enqueuePayLink(user.id, "/welcome");
  assertEquals(await leads.drain(), { landed: 0, deferred: 1, waiting: 0 });
  const [rec] = await outbox.list();
  assertEquals([rec.kind, rec.attempts, rec.back], ["pay-link", 1, "/welcome"], "the way back survives the deferral");
  assertStringIncludes(rec.lastError ?? "", "503");
  const meanwhile = (await plans.get(user.id))!;
  assertEquals([meanwhile.payLinkError, meanwhile.payUrl], ["payments-unavailable", undefined], "the hand-off page can say it is taking longer");
  assertEquals(await leads.drain(Date.parse(rec.nextAt)), { landed: 1, deferred: 0, waiting: 0 });
  const plan = (await plans.get(user.id))!;
  assertEquals([plan.payUrl, plan.payLinkError], ["http://crm/pay?due=d-9900&account=primary&n=1", undefined]);
  assertEquals(calls, ["/api/payments/customers", "/api/payments/dues", "/api/payments/customers", "/api/payments/dues", "/api/payments/pay-links"], "the retry is the whole mint again — the CRM upserts the customer by ref");
  assertEquals(await outbox.list(), []);
  await done();
});

Deno.test("REQ-106 a name the CRM has no record of ends the record: the plan reads merchant-unknown, no page, and nothing is retried", async () => {
  const { calls, outbox, leads, plans, user } = await freshPay({ link: [{ status: 422 }] });
  await leads.enqueuePayLink(user.id, "/settings");
  assertEquals(await leads.drain(), { landed: 1, deferred: 0, waiting: 0 });
  const plan = (await plans.get(user.id))!;
  assertEquals([plan.status, plan.payUrl, plan.payLinkError], ["pending", undefined, "merchant-unknown"]);
  assertEquals(await outbox.list(), [], "the refusal is final: the person picks again");
  assertEquals(await leads.drain(Date.now() + 60_000), { landed: 0, deferred: 0, waiting: 0 });
  assertEquals(calls.length, 3, "nothing retried");
  await done();
});

Deno.test("REQ-106 a newer pick made while the first page is being minted is the one that lands: the stale page is never written over it, and the sweep that follows mints the newer pick", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const mints: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  const link = {
    createCustomer: () => Promise.resolve({ customerId: "c-106" }),
    raiseDue: (input: { amountCents: number }) => Promise.resolve({ dueId: `d-${input.amountCents}` }),
    async mintPayLink(input: { dueId: string }) {
      mints.push(input.dueId);
      if (mints.length === 1) await held; // the first page sits on the CRM
      return { payUrl: `http://crm/pay?due=${input.dueId}` };
    },
  } as unknown as PaymentsLink;
  const users = new UserStore();
  const plans = new PlanStore();
  const crm = new CrmCustomerSync(users, new BusinessIdentityStore(), link, plans);
  const outbox = new CrmCaptureOutbox();
  const leads = new CrmLeadCapture(outbox, crm, {} as SignupNotice, new PayLinkMint(plans, link, crm));
  const user = await users.create({ phoneNumber: "+15125551062", email: "r@roof.test", name: "Rae" });
  await plans.put(chosen(user.id, "monster", "2026-10-20T10:00:00.000Z", { merchant: "primary" }));
  await leads.enqueuePayLink(user.id, "/welcome");
  await until(() => mints.length >= 1);
  // a change of mind while the first page is held: a newer pick, its record re-marked
  await plans.put(chosen(user.id, "assist", "2026-10-20T10:00:05.000Z", { merchant: "primary" }));
  await leads.enqueuePayLink(user.id, "/welcome");
  release();
  await leads.drain(); // the first sweep ends: its page is not the newer pick's, so it is not written; the re-marked record stays
  const stale = (await plans.get(user.id))!;
  assertEquals([stale.planId, stale.payUrl], ["assist", undefined], "the stale page never landed on the newer pick");
  // the sweep that follows (the re-mark flagged it) mints the newer pick
  await until(() => mints.length >= 2);
  let final = (await plans.get(user.id))!;
  for (let i = 0; i < 200 && !final.payUrl; i++) {
    await new Promise((r) => setTimeout(r, 10));
    final = (await plans.get(user.id))!;
  }
  assertEquals(mints, ["d-9900", "d-19900"], "both pages were minted, the newer one last");
  assertEquals(final.planId, "assist", "the newer pick stood throughout");
  assertEquals(final.payUrl, "http://crm/pay?due=d-19900", "the page on the record is the newer pick's, never the stale one");
  assertEquals(await outbox.list(), []);
  await done();
});
