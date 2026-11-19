/** REQ-924 — GET /customers/:id/workspace: one customer's card, money summary, documents, payments,
 *  repeat visits (with the next visits by the schedule) and work orders; 404 for another account. */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { UsersModule } from "@users/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { WorkOrderStore } from "@paperwork/domain/data/work-order-store/mod.ts";
import { FieldTaskStore, SubscriptionStore, TaskTypeStore } from "@field/domain/data/field-stores/mod.ts";
import { fieldToday, shiftDate } from "@field/domain/business/schedule/mod.ts";
import type { FieldTask, Subscription } from "@field/dto/field.ts";

@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}
const PORT = 9174;
const J = { "content-type": "application/json" };

async function withServer(fn: (base: string) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try { await fn(`http://localhost:${PORT}`); } finally { await server.stop(); await resetKv(); }
}
async function login(base: string, phone: string): Promise<Record<string, string>> {
  await (await fetch(`${base}/auth/send-otp`, { method: "POST", headers: J, body: JSON.stringify({ phoneNumber: phone }) })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base}/auth/verify-otp`, { method: "POST", headers: J, body: JSON.stringify({ phoneNumber: phone, code: stored!.code }) }).then((r) => r.json());
  return { ...J, "x-session-id": v.sessionId };
}

Deno.test("REQ-924 GET /customers/:id/workspace — summary, documents, payments, services with next visits, visits, work orders; 404 for another account", async () => {
  await withServer(async (base) => {
    const H = await login(base, "+15125559241");
    const c = await fetch(`${base}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: "Oceanview HOA", phoneNumber: "(305) 555-0188" }) }).then((r) => r.json());
    const other = await fetch(`${base}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: "Somebody Else" }) }).then((r) => r.json());
    const uid: string = c.userId;
    const today = fieldToday();

    const invoices = new InvoiceStore();
    const overdue = await invoices.create(uid, { customerId: c.id, status: "sent", amount: 1240000, dueDate: shiftDate(today, -10), issuedDate: shiftDate(today, -40), jobName: "Building C membrane" } as never);
    await invoices.update(overdue.id, uid, { paidCents: 620000 } as never).catch(async () => {
      // the store may not take paidCents in an update — the payment below is what the API records anyway
    });
    const notDue = await invoices.create(uid, { customerId: c.id, status: "sent", amount: 50000, dueDate: shiftDate(today, 20), jobName: "Drain check" } as never);
    await invoices.create(uid, { customerId: c.id, status: "draft", amount: 99900, dueDate: shiftDate(today, 30) } as never);
    await invoices.create(uid, { customerId: other.id, status: "sent", amount: 777700, dueDate: shiftDate(today, -5) } as never);
    await new PaymentStore().create(uid, { invoiceId: overdue.id, amount: 620000, method: "ach", receivedAt: shiftDate(today, -8) });
    await new QuoteStore().create(uid, { customerId: c.id, jobName: "Building D inspection", estimatedTotal: 90000, status: "sent" } as never);
    await new WorkOrderStore().create(uid, { customerId: c.id, description: "Membrane repair" } as never);

    const type = { id: crypto.randomUUID(), userId: uid, name: "Roof drain check", createdAt: today, updatedAt: today };
    await new TaskTypeStore().put(type as never);
    const tuesday = (() => { let d = shiftDate(today, -21); while (new Date(d + "T00:00:00Z").getUTCDay() !== 2) d = shiftDate(d, 1); return d; })();
    const sub: Subscription = { id: crypto.randomUUID(), userId: uid, customerId: c.id, address: "1 Ocean Dr", lat: 0, lng: 0, items: [{ taskTypeId: type.id, priceCents: 14000 }], cadence: "weekly", days: [2], startDate: tuesday, active: true, createdAt: today, updatedAt: today } as Subscription;
    await new SubscriptionStore().put(sub);
    const task = (date: string, status: FieldTask["status"], invoiceId?: string): FieldTask => ({ id: crypto.randomUUID(), userId: uid, subscriptionId: sub.id, taskTypeId: type.id, customerId: c.id, regionId: "", workerId: "", date, priceCents: 14000, status, ...(invoiceId ? { invoiceId } : {}) } as FieldTask);
    await new FieldTaskStore().putMany([task(tuesday, "complete", notDue.id), task(shiftDate(tuesday, 7), "complete"), task(shiftDate(tuesday, 14), "skipped")]);

    const r = await fetch(`${base}/customers/${c.id}/workspace`, { headers: H });
    assertEquals(r.status, 200);
    const ws = await r.json();
    assertEquals(ws.customer.id, c.id);
    assertEquals(ws.customer.name, "Oceanview HOA");
    assertEquals([ws.customer.balanceCents, ws.customer.overdueCents], [670000, 620000], "the card carries the overdue part (the sidebar's line)");
    assertEquals(ws.summary.owedCents, 620000 + 50000, "what is owed: the overdue balance and the one not due yet");
    assertEquals(ws.summary.overdueCents, 620000);
    assertEquals(ws.summary.billedCents, 1240000 + 50000, "the draft is not billed; the other customer's invoice is not hers");
    assertEquals(ws.summary.lastPayment.amountCents, 620000);
    assertEquals(ws.summary.lastPayment.method, "ach");
    assertEquals([ws.summary.openQuotes, ws.summary.openQuotesCents], [1, 90000]);
    assertEquals(ws.summary.activeServices, 1);
    assertEquals(ws.summary.recurringMonthlyCents, Math.round(14000 * 52 / 12));
    assertEquals([ws.summary.unbilledVisits, ws.summary.unbilledCents], [1, 14000], "one done visit is billed on a live invoice, one is not, the skipped one is not a visit to bill");
    assert(ws.summary.nextVisit >= today, "the next visit is today or later");

    assertEquals(ws.invoices.length, 3, "her three invoices, the other customer's left out");
    const od = ws.invoices.find((i: { id: string }) => i.id === overdue.id);
    assertEquals([od.balanceCents, od.state, od.overdueDays], [620000, "sent", 10]);
    assertEquals(od.url, `/i/${overdue.id}`);
    assertEquals(ws.quotes.map((q: { amountCents: number }) => q.amountCents), [90000]);
    assertEquals(ws.payments.length, 1);
    assertEquals(ws.payments[0].invoiceNumber, od.number);
    assertEquals(ws.workOrders.length, 1);

    assertEquals(ws.services.length, 1);
    const s = ws.services[0];
    assertEquals([s.perVisitCents, s.monthlyCents, s.items[0].taskTypeName], [14000, Math.round(14000 * 52 / 12), "Roof drain check"]);
    assertEquals(s.nextVisits.length, 5);
    assert(s.nextVisits.every((d: string) => d >= today && new Date(d + "T00:00:00Z").getUTCDay() === 2), "the next five Tuesdays");
    assertEquals(s.unbilledVisits, 1);
    assertEquals(ws.visits.map((v: { status: string }) => v.status), ["skipped", "complete", "complete"], "newest first");
    assertEquals(ws.visits[2].invoiceNumber, ws.invoices.find((i: { id: string }) => i.id === notDue.id).number);

    const H2 = await login(base, "+15125559242");
    const foreign = await fetch(`${base}/customers/${c.id}/workspace`, { headers: H2 });
    assertEquals(foreign.status, 404, "another account's customer");
    await foreign.body?.cancel();
    const missing = await fetch(`${base}/customers/nope/workspace`, { headers: H });
    assertEquals(missing.status, 404);
    await missing.body?.cancel();
    const anon = await fetch(`${base}/customers/${c.id}/workspace`);
    assertEquals(anon.status, 401);
    await anon.body?.cancel();
  });
});

// REQ-1063 (LOOP-007 q2, q2-52) — the workspace's RECURRING figure honours the repeat visit's end date
// (REQ-1004): a running weekly $85 visit with 6 visits left reports its end date and the $510 left;
// one whose end date is past counts as neither active nor recurring though it is still active=true.
Deno.test("REQ-1063 (LOOP-007 q2, q2-52) GET /customers/:id/workspace — a repeat visit's end date: summary.recurringEndsOn and services[0].remainingCents ($510 left) while it runs", async () => {
  await withServer(async (base) => {
    const H = await login(base, "+15125551063");
    const c = await fetch(`${base}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: "Seasonal Sam" }) }).then((r) => r.json());
    const uid: string = c.userId;
    const today = fieldToday();
    const type = { id: crypto.randomUUID(), userId: uid, name: "Lawn cut", createdAt: today, updatedAt: today };
    await new TaskTypeStore().put(type as never);
    const tomorrow = shiftDate(today, 1);
    const weekday = new Date(tomorrow + "T00:00:00Z").getUTCDay();
    // visits tomorrow, +8, +15, +22, +29, +36 → 6 left; the next one (+43) is past the end (+41)
    const endDate = shiftDate(today, 41);
    const base_ = { userId: uid, customerId: c.id, address: "1 Ocean Dr", lat: 0, lng: 0, items: [{ taskTypeId: type.id, priceCents: 8500 }], cadence: "weekly", days: [weekday], startDate: shiftDate(today, -27), active: true, createdAt: today, updatedAt: today };
    const running = { ...base_, id: crypto.randomUUID(), endDate } as Subscription;
    await new SubscriptionStore().put(running);

    const ws = await fetch(`${base}/customers/${c.id}/workspace`, { headers: H }).then((r) => r.json());
    assertEquals(ws.summary.activeServices, 1);
    assertEquals(ws.summary.recurringMonthlyCents, Math.round(8500 * 52 / 12), "the /mo rate stays (REQ-924)");
    assertEquals(ws.summary.recurringEndsOn, endDate, "the summary says when the recurring income ends");
    assertEquals(ws.services[0].endDate, endDate);
    assertEquals(ws.services[0].remainingCents, 6 * 8500, "6 visits left × $85 = $510");
  });
});

Deno.test("REQ-1063 (LOOP-007 q2, q2-52) GET /customers/:id/workspace — a repeat visit whose end date has passed (still active=true) is not active and adds $0/mo", async () => {
  await withServer(async (base) => {
    const H = await login(base, "+15125551064");
    const c = await fetch(`${base}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: "Seasonal Sue" }) }).then((r) => r.json());
    const uid: string = c.userId;
    const today = fieldToday();
    const type = { id: crypto.randomUUID(), userId: uid, name: "Lawn cut", createdAt: today, updatedAt: today };
    await new TaskTypeStore().put(type as never);
    // ran weekly for six weeks, ended yesterday — nobody paused it
    const ended = { id: crypto.randomUUID(), userId: uid, customerId: c.id, address: "1 Ocean Dr", lat: 0, lng: 0, items: [{ taskTypeId: type.id, priceCents: 8500 }], cadence: "weekly", days: [new Date(today + "T00:00:00Z").getUTCDay()], startDate: shiftDate(today, -42), endDate: shiftDate(today, -1), active: true, createdAt: today, updatedAt: today } as Subscription;
    await new SubscriptionStore().put(ended);
    const ws = await fetch(`${base}/customers/${c.id}/workspace`, { headers: H }).then((r) => r.json());
    assertEquals(ws.summary.activeServices, 0, "an ended repeat visit is not an active one");
    assertEquals(ws.summary.recurringMonthlyCents, 0, "an ended repeat visit adds nothing per month");
    assertEquals(ws.summary.recurringEndsOn, undefined);
  });
});

// REQ-1140 (LOOP-007 q3, q3-71) — a signed job leaves the customer's Jobs tab at 0. The customer signs
// her quote through the public accept endpoint (which bills it: an unpaid invoice), then her workspace
// must list that signed quote as one active job — the same count the board's card shows as activeJobs.
Deno.test("REQ-1140 (LOOP-007 q3, q3-71) GET /customers/:id/workspace — after the customer signs Q-001 the workspace lists one active job (that quote), matching the card's activeJobs", async () => {
  await withServer(async (base) => {
    const H = await login(base, "+15125551140");
    const c = await fetch(`${base}/customers`, { method: "POST", headers: H, body: JSON.stringify({ name: "Lucia Herrera" }) }).then((r) => r.json());
    const q = await fetch(`${base}/quotes`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        customerId: c.id,
        summary: "Kitchen backsplash",
        jobName: "Kitchen backsplash",
        lineItems: [{ description: "Kitchen backsplash", quantity: 1, unit: "job", price: 240000 }],
        estimatedTotal: 240000,
      }),
    }).then((r) => r.json());
    await new QuoteStore().update(q.id, c.userId, { status: "sent", sentAt: new Date().toISOString() } as never);
    const signed = await fetch(`${base}/quotes/${q.id}/accept`, {
      method: "POST",
      headers: J,
      body: JSON.stringify({ name: "Lucia Herrera", signature: "Lucia Herrera" }),
    });
    assertEquals(signed.status, 200, await signed.text());

    const ws = await fetch(`${base}/customers/${c.id}/workspace`, { headers: H }).then((r) => r.json());
    assertEquals(ws.customer.activeJobs, 1, "the board's card: one signed job in flight (REQ-562)");
    assertEquals(ws.workOrders.length, 0, "signing creates no work order (REQ-210)");
    assert(Array.isArray(ws.jobs), `the workspace carries the customer's signed jobs — got jobs=${JSON.stringify(ws.jobs)}`);
    assertEquals(ws.jobs.length, 1, "one signed quote → one job");
    assertEquals(ws.jobs[0].id, q.id, "the job is the signed quote");
    assertEquals(ws.jobs[0].number, "Q-001");
    assertEquals(ws.jobs[0].active, true, "its invoice is unpaid: the job is in flight");
    assertEquals(ws.jobs[0].url, `/quotes?open=${q.id}`);
    assertEquals(ws.jobs.filter((j: { active: boolean }) => j.active).length, ws.customer.activeJobs, "the Jobs tab and the board count the same jobs");
  });
});
