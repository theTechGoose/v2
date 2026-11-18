/** REQ-924 — POST /field/batches/pull with `customerId`: the customer page's "Bill now" drafts only
 *  that customer's done visits; the other customers' visits stay unbilled for the next pull. */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { FieldModule } from "@field/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { FieldTaskStore, SubscriptionStore, TaskTypeStore } from "@field/domain/data/field-stores/mod.ts";
import { fieldToday, shiftDate } from "@field/domain/business/schedule/mod.ts";
import type { FieldTask, Subscription } from "@field/dto/field.ts";

@Module({ imports: [FieldModule] })
class TestApp {}
const PORT = 9175;
const J = { "content-type": "application/json" };

Deno.test("REQ-924 POST /field/batches/pull {customerId} — drafts only that customer's done visits", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  const base = `http://localhost:${PORT}`;
  try {
    const phone = "+15125559243";
    await (await fetch(`${base}/auth/send-otp`, { method: "POST", headers: J, body: JSON.stringify({ phoneNumber: phone }) })).body?.cancel();
    const code = (await new OtpStore().get(phone))!.code;
    const v = await fetch(`${base}/auth/verify-otp`, { method: "POST", headers: J, body: JSON.stringify({ phoneNumber: phone, code }) }).then((r) => r.json());
    const H = { ...J, "x-session-id": v.sessionId };
    const a = await fetch(`${base}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: "Ana Pena" }) }).then((r) => r.json());
    const b = await fetch(`${base}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: "Bob Smith" }) }).then((r) => r.json());
    const uid: string = a.userId;
    const today = fieldToday();
    const type = { id: crypto.randomUUID(), userId: uid, name: "Gutter cleaning", createdAt: today, updatedAt: today };
    await new TaskTypeStore().put(type as never);
    const sub = (customerId: string): Subscription => ({ id: crypto.randomUUID(), userId: uid, customerId, address: "1 Main St", lat: 0, lng: 0, items: [{ taskTypeId: type.id, priceCents: 12000 }], cadence: "weekly", days: [1], startDate: shiftDate(today, -30), active: true, createdAt: today, updatedAt: today } as Subscription);
    const sa = sub(a.id), sb = sub(b.id);
    await new SubscriptionStore().put(sa);
    await new SubscriptionStore().put(sb);
    const done = (s: Subscription, date: string): FieldTask => ({ id: crypto.randomUUID(), userId: uid, subscriptionId: s.id, taskTypeId: type.id, customerId: s.customerId, regionId: "", workerId: "", date, priceCents: 12000, status: "complete" } as FieldTask);
    await new FieldTaskStore().putMany([done(sa, shiftDate(today, -7)), done(sa, shiftDate(today, -14)), done(sb, shiftDate(today, -7))]);

    const from = shiftDate(today, -365), to = today;
    const mine = await fetch(`${base}/field/batches/pull`, { method: "POST", headers: H, body: JSON.stringify({ from, to, customerId: a.id }) });
    assertEquals(mine.status, 201);
    const pulled = await mine.json();
    assertEquals(pulled.invoices.map((i: { customerId: string }) => i.customerId), [a.id], "one draft, Ana's");
    assertEquals(pulled.invoices[0].amount, 24000, "her two visits");

    const rest = await fetch(`${base}/field/batches/pull`, { method: "POST", headers: H, body: JSON.stringify({ from, to }) }).then((r) => r.json());
    assertEquals(rest.invoices.map((i: { customerId: string }) => i.customerId), [b.id], "Bob's visit was left for the next pull; Ana's are billed");

    const bad = await fetch(`${base}/field/batches/pull`, { method: "POST", headers: H, body: JSON.stringify({ from, to, customerId: 42 }) });
    assertEquals(bad.status, 400, "a customerId that is not a string");
    await bad.body?.cancel();
  } finally {
    await server.stop();
    await resetKv();
  }
});
