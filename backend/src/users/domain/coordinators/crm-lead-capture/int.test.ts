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
import { assert, assertEquals } from "#std/assert";
import { kvCache, resetKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import { CrmLeadCapture } from "./mod.ts";

type Answer = { status: number } | "hang";

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
  const crm = new CrmCustomerSync(new UserStore(), new BusinessIdentityStore(), link, new PlanStore());
  const make = () => new CrmLeadCapture(outbox, crm);
  return { calls, outbox, make };
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
  const leads = new CrmLeadCapture(outbox, crm);
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
