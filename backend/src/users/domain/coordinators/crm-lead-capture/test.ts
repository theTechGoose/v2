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
