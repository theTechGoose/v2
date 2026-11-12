/**
 * REQ-508 — demo-loop cycle 3, issue m20 ("Heavy polling; the browser calls POST
 * /api/cron/run-nudges on every /invoices load"). The scheduled-invoice nudge sweep runs on the
 * server, on REQ-074's isolate timer (a minute tick, never Deno.cron), over every account that
 * has invoices, behind a KV lease so one isolate sweeps per period, and emits each invoice's nudge
 * at most once a day. No page view is needed for a nudge.
 *
 * Real InvoiceStore/KV layout on an in-memory KV; the EventBus is the real one.
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { type DomainEvent, EventBus } from "@core/business/events/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import { NUDGE_SWEEP_EVERY_MS, ScheduleInvoiceNudges } from "./mod.ts";

const NOW = new Date("2026-05-14T08:00:00Z");

async function seed(
  userId: string,
  id: string,
  over: Partial<Invoice>,
): Promise<void> {
  const kv = await getKv();
  const inv: Invoice = {
    id,
    userId,
    quoteId: "q-1",
    dueDate: "2026-06-14",
    amount: 100_00,
    status: "scheduled",
    scheduledFor: "2026-05-14",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...over,
  };
  await kv.set(["invoice", id], inv);
  await kv.set(["invoice_by_user", userId, id], id);
}

async function withKv(
  fn: (nudges: ScheduleInvoiceNudges, events: DomainEvent[]) => Promise<void>,
) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const bus = new EventBus();
  const events: DomainEvent[] = [];
  bus.subscribe((e) => {
    events.push(e);
  });
  try {
    await fn(new ScheduleInvoiceNudges(new InvoiceStore(), bus), events);
  } finally {
    await resetKv();
  }
}

const nudged = (events: DomainEvent[]) =>
  events.filter((e) => e.action === "nudge_due").map((e) =>
    `${e.userId}/${e.entityId}`
  ).sort();

Deno.test("REQ-508 m20 sweep — every account's due scheduled invoices are nudged, with no request from anyone", async () => {
  await withKv(async (nudges, events) => {
    await seed("u-a", "a-due", {}); // today
    await seed("u-a", "a-tomorrow", { scheduledFor: "2026-05-15" }); // one-day lookahead
    await seed("u-a", "a-later", { scheduledFor: "2026-05-30" }); // not yet
    await seed("u-a", "a-sent", { status: "sent" }); // not scheduled
    await seed("u-b", "b-due", { scheduledFor: "2026-05-10" }); // overdue to send
    await seed("u-c", "c-paid", { status: "paid" }); // an account with nothing due
    const r = await nudges.sweep(NOW);
    assertEquals(r, { ran: true, accounts: 3, nudged: 3 });
    assertEquals(nudged(events), ["u-a/a-due", "u-a/a-tomorrow", "u-b/b-due"]);
    const ev = events.find((e) => e.entityId === "a-due")!;
    assertEquals(ev.entityType, "invoice");
    assertEquals(ev.data?.dayBucket, "2026-05-14");
  });
});

Deno.test("REQ-508 m20 sweep — an invoice is nudged once a day: later sweeps that day emit nothing; the next day nudges again", async () => {
  await withKv(async (nudges, events) => {
    await seed("u-a", "a-due", {});
    assertEquals((await nudges.sweep(NOW)).nudged, 1);
    const later = new Date(NOW.getTime() + NUDGE_SWEEP_EVERY_MS);
    assertEquals(await nudges.sweep(later), {
      ran: true,
      accounts: 1,
      nudged: 0,
    });
    assertEquals(nudged(events), ["u-a/a-due"]);
    const tomorrow = new Date(NOW.getTime() + 24 * 3600 * 1000);
    assertEquals(
      (await nudges.sweep(tomorrow)).nudged,
      1,
      "still scheduled the next day: nudged again",
    );
    assertEquals(events.length, 2);
  });
});

Deno.test("REQ-508 m20 sweep — the lease: a sweep inside the period of the last one does nothing; two at once, one runs", async () => {
  await withKv(async (nudges, events) => {
    await seed("u-a", "a-due", {});
    const [x, y] = await Promise.all([nudges.sweep(NOW), nudges.sweep(NOW)]);
    assertEquals(
      [x.ran, y.ran].sort(),
      [false, true],
      "one of two concurrent sweeps holds the lease",
    );
    const soon = new Date(NOW.getTime() + 60_000);
    assertEquals(await nudges.sweep(soon), {
      ran: false,
      accounts: 0,
      nudged: 0,
    }, "a minute later the lease still holds");
    // another isolate's sweeper (a second instance over the same KV) is held off too
    const other = new ScheduleInvoiceNudges(new InvoiceStore(), new EventBus());
    assertEquals((await other.sweep(soon)).ran, false);
    assertEquals(events.length, 1);
  });
});

Deno.test("REQ-508 m20 registerSweep — REQ-074's isolate timer: every 60 s, unref'd, each tick sweeps, Deno.cron never called, never throws", async () => {
  await withKv(async (nudges, events) => {
    await seed("u-a", "a-due", {
      scheduledFor: new Date().toISOString().slice(0, 10),
    });
    const deno = Deno as unknown as { cron?: unknown };
    const hadCron = Object.getOwnPropertyDescriptor(Deno, "cron");
    let cronCalls = 0;
    Object.defineProperty(Deno, "cron", {
      configurable: true,
      writable: true,
      value: () => ++cronCalls,
    });
    const held: { tick?: () => void; everyMs?: number } = {};
    const unrefd: number[] = [];
    try {
      assert(nudges.registerSweep((fn, ms) => {
        held.tick = fn;
        held.everyMs = ms;
        return 42;
      }, (id) => unrefd.push(id)));
      assertEquals(cronCalls, 0, "Deno.cron is never touched");
    } finally {
      if (hadCron) Object.defineProperty(Deno, "cron", hadCron);
      else delete deno.cron;
    }
    assertEquals(held.everyMs, 60_000);
    assertEquals(unrefd, [42]);
    held.tick!();
    for (let i = 0; i < 50 && events.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assertEquals(nudged(events), ["u-a/a-due"], "a tick sweeps");

    const lines: string[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => lines.push(a.map(String).join(" "));
    try {
      assertEquals(
        nudges.registerSweep(() => {
          throw new Error("no timers here");
        }, () => {}),
        false,
      );
      assertStringIncludes(lines.at(-1) ?? "", "no timers here");
    } finally {
      console.warn = warn;
    }
  });
});

Deno.test("REQ-508 m20 sweep — an unreadable KV is logged and resolved, never thrown into the timer", async () => {
  const nudges = new ScheduleInvoiceNudges(
    {
      listByUser: () => Promise.reject(new Error("kv closed")),
    } as unknown as InvoiceStore,
    new EventBus(),
  );
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const kv = await getKv();
    await kv.set(["invoice_by_user", "u-a", "x"], "x");
    const lines: string[] = [];
    const err = console.error;
    console.error = (...a: unknown[]) => lines.push(a.map(String).join(" "));
    try {
      const r = await nudges.sweep(NOW);
      assertEquals(r.ran, true);
      assertEquals(r.nudged, 0);
      assertStringIncludes(lines.join("\n"), "kv closed");
    } finally {
      console.error = err;
    }
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-508 m20 bootstrap — the backend starts the nudge sweep's timer at boot", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../../../bootstrap/mod.ts", import.meta.url),
  );
  assert(
    /app\.get\(ScheduleInvoiceNudges\)/.test(src),
    "bootstrap gets ScheduleInvoiceNudges",
  );
  assert(
    /registerSweep\(\)/.test(src.slice(src.indexOf("ScheduleInvoiceNudges)"))),
    "and registers its minute sweep",
  );
});
