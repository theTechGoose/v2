/**
 * REQ-508 — demo-loop cycle 3, issue m20. Across modules on a real (in-memory) KV: invoices made
 * through the real InvoiceStore, the server-side sweep (no HTTP request, no page view), the real
 * NotifyOnEvent subscriber — the contractor's notification lands once, however often the sweep
 * runs that day.
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";
import { NotifyOnEvent } from "@communication/domain/coordinators/notify-on-event/mod.ts";
import { NUDGE_SWEEP_EVERY_MS, ScheduleInvoiceNudges } from "./mod.ts";

Deno.test("REQ-508 m20 int — a scheduled invoice's nudge reaches the contractor's notifications from the server sweep alone, once", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const bus = new EventBus();
    const notes = new NotificationStore();
    new NotifyOnEvent(bus, notes);
    const store = new InvoiceStore();
    const today = new Date().toISOString().slice(0, 10);
    const inv = await store.create("u-int", {
      customerId: "c-1",
      amount: 800_00,
      status: "scheduled",
      scheduledFor: today,
    } as never);
    const nudges = new ScheduleInvoiceNudges(store, bus);
    const now = new Date();
    assertEquals((await nudges.sweep(now)).nudged, 1);
    await nudges.sweep(new Date(now.getTime() + NUDGE_SWEEP_EVERY_MS));
    const rows = (await notes.listByUser("u-int")).filter((n) =>
      n.entityId === inv.id && n.type === "invoice_nudge_due"
    );
    assertEquals(rows.length, 1);
  } finally {
    await resetKv();
  }
});
