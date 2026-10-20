// REQ-073 — the lead-capture outbox's boot work never takes the isolate down: a sweep that
// cannot read its outbox resolves with the failure named. REQ-074 — the minute sweep is a timer
// in the isolate, never Deno.cron (a revision that calls it never routes). Pure: stub outbox,
// stub CRM, injected timer.
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import type { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import type { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { CrmLeadCapture } from "./mod.ts";

function capture(method: "warn" | "error") {
  const lines: string[] = [];
  const original = console[method];
  console[method] = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  return { lines, restore: () => (console[method] = original) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

Deno.test("REQ-073 drain — an outbox that cannot be read resolves with the failure named and logged; it never rejects", async () => {
  const outbox = { list: () => Promise.reject(new Error("kv closed")) } as unknown as CrmCaptureOutbox;
  const crm = { capture: () => Promise.resolve({ customerId: "never" }) } as unknown as CrmCustomerSync;
  const logged = capture("error");
  try {
    const result = await new CrmLeadCapture(outbox, crm).drain();
    assertEquals(result, { landed: 0, deferred: 0, waiting: 0, failed: "kv closed" });
    assertEquals(logged.lines.length, 1);
    assertStringIncludes(logged.lines[0], "kv closed");
  } finally {
    logged.restore();
  }
});

Deno.test("REQ-074 registerSweep — the minute sweep is an in-isolate timer: Deno.cron is never called", () => {
  const outbox = { list: () => Promise.resolve([]) } as unknown as CrmCaptureOutbox;
  const leads = new CrmLeadCapture(outbox, {} as CrmCustomerSync);
  const deno = Deno as unknown as { cron?: unknown };
  const hadCron = Object.getOwnPropertyDescriptor(Deno, "cron");
  let cronCalls = 0;
  Object.defineProperty(Deno, "cron", { configurable: true, writable: true, value: () => ++cronCalls });
  const timers: { ms: number }[] = [];
  const timer = (_fn: () => void, ms: number) => {
    timers.push({ ms });
    return 7;
  };
  try {
    assert(leads.registerSweep(timer, () => {}), "the sweep is scheduled");
    assertEquals(cronCalls, 0, "Deno.cron is never touched — a revision that calls it never routes");
    assertEquals(timers.length, 1);
  } finally {
    if (hadCron) Object.defineProperty(Deno, "cron", hadCron);
    else delete deno.cron;
  }
});

Deno.test("REQ-074 registerSweep — the timer fires every 60 s and each tick sweeps the outbox; the timer never keeps the process alive and never throws", async () => {
  let lists = 0;
  const outbox = {
    list: () => {
      lists++;
      return Promise.resolve([]);
    },
  } as unknown as CrmCaptureOutbox;
  const leads = new CrmLeadCapture(outbox, {} as CrmCustomerSync);
  const held: { tick?: () => void; everyMs?: number } = {};
  const timer = (fn: () => void, ms: number) => {
    held.tick = fn;
    held.everyMs = ms;
    return 42;
  };
  const unrefd: number[] = [];
  assert(leads.registerSweep(timer, (id: number) => unrefd.push(id)));
  assertEquals(held.everyMs, 60_000);
  assertEquals(unrefd, [42], "the timer is unref'd: it never holds the process open");
  assert(held.tick, "a tick is scheduled");
  held.tick();
  held.tick();
  await tick();
  assert(lists >= 1, "a tick sweeps the outbox");

  const logged = capture("warn");
  try {
    const throws = () => {
      throw new Error("no timers here");
    };
    assertEquals(leads.registerSweep(throws, () => {}), false, "a timer that cannot be set is logged, never thrown");
    assertStringIncludes(logged.lines.at(-1) ?? "", "no timers here");
  } finally {
    logged.restore();
  }
});

// REQ-098 — Raphael, 2026-10-20: "it should fire the event to the backend and forget about it while
// the backend finishes the request." The account's CRM customer (REQ-058) rides the same outbox as
// the lead: a record carrying a userId is carried by CrmCustomerSync.ensure.
Deno.test("REQ-098 sweep — a record carrying a userId is the account's customer sync: carried by ensure and cleared by its record; a phone record stays a lead capture", async () => {
  const at = "2026-10-20T00:00:00.000Z";
  const lead = { phone: "+15125550098", enqueuedAt: at, attempts: 0, nextAt: at };
  const sync = { phone: "", userId: "u-98", enqueuedAt: at, attempts: 0, nextAt: at };
  const cleared: unknown[] = [];
  const outbox = {
    list: () => Promise.resolve([lead, sync]),
    claim: () => Promise.resolve(true),
    done: (rec: unknown) => {
      cleared.push(rec);
      return Promise.resolve();
    },
  } as unknown as CrmCaptureOutbox;
  const calls: string[] = [];
  const crm = {
    capture: (phone: string) => {
      calls.push(`capture ${phone}`);
      return Promise.resolve({ customerId: "c-lead" });
    },
    ensure: (userId: string) => {
      calls.push(`ensure ${userId}`);
      return Promise.resolve({ customerId: "c-user" });
    },
  } as unknown as CrmCustomerSync;
  assertEquals(await new CrmLeadCapture(outbox, crm).drain(Date.parse(at) + 1), { landed: 2, deferred: 0, waiting: 0 });
  assertEquals(calls, ["capture +15125550098", "ensure u-98"]);
  assertEquals(cleared, [lead, sync]);
});

Deno.test("REQ-098 a record enqueued while a sweep is running is swept right after it, not left for the next login", async () => {
  const at = "2026-10-20T00:00:00.000Z";
  let lists = 0;
  const outbox = {
    list: () => {
      lists++;
      return Promise.resolve(lists === 1 ? [] : []);
    },
    add: () => Promise.resolve(),
    addSync: () => Promise.resolve(),
  } as unknown as CrmCaptureOutbox;
  const leads = new CrmLeadCapture(outbox, {} as CrmCustomerSync);
  const first = leads.drain(Date.parse(at));
  await leads.enqueueSync("u-98"); // arrives while the first sweep is on its list
  await first;
  await tick();
  await tick();
  assertEquals(lists, 2, "a second sweep followed the first for the record that arrived meanwhile");
});
