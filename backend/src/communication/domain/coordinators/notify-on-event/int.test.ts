import { assertEquals } from "#std/assert";
import {
  localizeNotification,
  mapEventToNotification,
  NotifyOnEvent,
} from "./mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("mapEventToNotification: quote sent → quote_sent with customer name", () => {
  const out = mapEventToNotification({
    userId: "u-1", entityType: "quote", entityId: "q-1", action: "sent",
    data: { customerName: "Acme Roofing" },
    timestamp: "2026-04-26T12:00:00.000Z",
  });
  assertEquals(out, { type: "quote_sent", title: "Quote sent to Acme Roofing" });
});

Deno.test("mapEventToNotification: invoice paid includes amount", () => {
  const out = mapEventToNotification({
    userId: "u-1", entityType: "invoice", entityId: "i-1", action: "paid",
    data: { customerName: "Acme", amount: "$1,000" },
    timestamp: "2026-04-26T12:00:00.000Z",
  });
  assertEquals(out, { type: "invoice_paid", title: "Acme paid $1,000" });
});

Deno.test("mapEventToNotification: invoice paid without amount stays clean (no trailing space)", () => {
  const out = mapEventToNotification({
    userId: "u-1", entityType: "invoice", entityId: "i-1", action: "paid",
    timestamp: "2026-04-26T12:00:00.000Z",
  });
  assertEquals(out?.title, "your client paid");
});

Deno.test("mapEventToNotification: unmapped (entityType, action) returns null", () => {
  assertEquals(
    mapEventToNotification({
      userId: "u-1", entityType: "quote", entityId: "q-1", action: "viewed-internal",
      timestamp: "2026-04-26T12:00:00.000Z",
    }),
    null,
  );
});

Deno.test("notify-on-event integration: bus.emit → notification record created", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const bus = new EventBus();
  const store = new NotificationStore();
  // Ctor subscribes to the bus.
  new NotifyOnEvent(bus, store);

  await bus.emit({
    userId: "u-1", entityType: "quote", entityId: "q-1", action: "accepted",
    data: { customerName: "Tom & Linda K." },
  });

  const list = await store.listByUser("u-1");
  assertEquals(list.length, 1);
  assertEquals(list[0].type, "quote_accepted");
  assertEquals(list[0].title, "Tom & Linda K. accepted your quote");
  assertEquals(list[0].entityType, "quote");
  assertEquals(list[0].entityId, "q-1");

  await resetKv();
});

Deno.test("notify-on-event integration: unmapped events do NOT create a notification", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const bus = new EventBus();
  const store = new NotificationStore();
  new NotifyOnEvent(bus, store);

  await bus.emit({
    userId: "u-1", entityType: "quote", entityId: "q-1", action: "viewed-internal",
  });
  assertEquals((await store.listByUser("u-1")).length, 0);
  await resetKv();
});

Deno.test("notify-on-event integration: scoped per userId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const bus = new EventBus();
  const store = new NotificationStore();
  new NotifyOnEvent(bus, store);

  await bus.emit({ userId: "u-1", entityType: "quote", entityId: "q-1", action: "sent", data: { customerName: "Acme" } });
  await bus.emit({ userId: "u-2", entityType: "quote", entityId: "q-2", action: "sent", data: { customerName: "Beta" } });

  assertEquals((await store.listByUser("u-1")).length, 1);
  assertEquals((await store.listByUser("u-2")).length, 1);
  assertEquals((await store.listByUser("u-1"))[0].title, "Quote sent to Acme");
  await resetKv();
});

Deno.test("REQ-224 integration: confirm + claim events through the bus → stored rows read as money and a method word", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const bus = new EventBus();
  const store = new NotificationStore();
  new NotifyOnEvent(bus, store);

  // The public claim (customer says they paid by Zelle).
  await bus.emit({
    userId: "u-1", entityType: "invoice", entityId: "i-1", action: "claimed",
    data: { method: "zelle", reference: "", customerName: "María Pérez" },
  });
  // ConfirmPayment's event: integer cents + the client.
  await bus.emit({
    userId: "u-1", entityType: "invoice", entityId: "i-1", action: "paid",
    data: { amountCents: 45000, method: "zelle", customerName: "María Pérez" },
  });

  const rows = await store.listByUser("u-1");
  const paid = rows.find((n) => n.type === "invoice_paid")!;
  const claimed = rows.find((n) => n.type === "invoice_claimed")!;
  assertEquals(localizeNotification(paid, "es").title, "María Pérez pagó $450");
  assertEquals(localizeNotification(paid, "en").title, "María Pérez paid $450");
  assertEquals(paid.title, "María Pérez paid $450"); // the stored fallback too
  assertEquals(
    localizeNotification(claimed, "es").title,
    "María Pérez dice que pagó por Zelle — confirma que lo recibiste",
  );
  assertEquals(
    localizeNotification(claimed, "en").title,
    "María Pérez says they paid via Zelle — confirm you got it",
  );
  await resetKv();
});
