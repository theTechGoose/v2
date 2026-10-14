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
import { resetKv } from "@core/data/kv/mod.ts";
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
async function fresh(answers: Answer[]) {
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
  const outbox = new CrmCaptureOutbox();
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
