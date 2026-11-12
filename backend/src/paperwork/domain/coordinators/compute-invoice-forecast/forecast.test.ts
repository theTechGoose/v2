import { assertEquals } from "#std/assert";
import {
  ComputeInvoiceForecast,
  forecastEntryFor,
  settlementOffsetDays,
} from "./mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

function inv(overrides: Partial<Invoice>): Invoice {
  return {
    id: "i-1",
    userId: "u-1",
    quoteId: "q-1",
    dueDate: "2026-05-21",
    amount: 100_00,
    status: "sent",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

Deno.test("settlementOffsetDays: per-method settlement windows", () => {
  // ACH and check are the slow rails. Same-day rails (Venmo/Zelle/Cash
  // App/cash) settle as soon as the customer hits send.
  assertEquals(settlementOffsetDays("ach"), 2);
  assertEquals(settlementOffsetDays("check"), 5);
  assertEquals(settlementOffsetDays("venmo"), 0);
  assertEquals(settlementOffsetDays("zelle"), 0);
  assertEquals(settlementOffsetDays("cashapp"), 0);
  assertEquals(settlementOffsetDays("cash"), 0);
  // "other" defaults conservatively to 3 days so we don't over-promise.
  assertEquals(settlementOffsetDays("other"), 3);
});

Deno.test("forecastEntryFor: paid invoice uses paidAt as land date", () => {
  const e = forecastEntryFor(
    inv({ status: "paid", paidAt: "2026-05-10T00:00:00Z" }),
    "Hansen",
  );
  assertEquals(e?.expectedLandDate, "2026-05-10");
  assertEquals(e?.source, "paid");
});

Deno.test("forecastEntryFor: claimed ACH lands claimedAt + 2 days", () => {
  const e = forecastEntryFor(
    inv({
      status: "claimed",
      paymentIntent: {
        method: "ach",
        amount: 100_00,
        claimedAt: "2026-05-10T00:00:00Z",
      },
    }),
    "Hansen",
  );
  assertEquals(e?.expectedLandDate, "2026-05-12");
  assertEquals(e?.source, "claimed");
  assertEquals(e?.label, "Hansen (ACH)");
});

Deno.test("forecastEntryFor: claimed check lands claimedAt + 5 days", () => {
  const e = forecastEntryFor(
    inv({
      status: "claimed",
      paymentIntent: {
        method: "check",
        amount: 100_00,
        claimedAt: "2026-05-10T00:00:00Z",
      },
    }),
    "Acme",
  );
  assertEquals(e?.expectedLandDate, "2026-05-15");
  assertEquals(e?.label, "Acme (check)");
});

Deno.test("forecastEntryFor: claimed Venmo/Zelle/Cash App same-day land", () => {
  const e = forecastEntryFor(
    inv({
      status: "claimed",
      paymentIntent: {
        method: "venmo",
        amount: 50_00,
        claimedAt: "2026-05-10T15:00:00Z",
      },
    }),
    "Hans",
  );
  assertEquals(e?.expectedLandDate, "2026-05-10");
});

Deno.test("forecastEntryFor: sent invoices use dueDate, source='sent_due'", () => {
  const e = forecastEntryFor(
    inv({ status: "sent", dueDate: "2026-05-21" }),
    "Hawthorne",
  );
  assertEquals(e?.expectedLandDate, "2026-05-21");
  assertEquals(e?.source, "sent_due");
});

Deno.test("forecastEntryFor: scheduled invoices are excluded from forecast", () => {
  // scheduled invoices are placeholder pipeline, not forecast revenue.
  const e = forecastEntryFor(
    inv({ status: "scheduled", scheduledFor: "2026-05-15" }),
    "X",
  );
  assertEquals(e, undefined);
});

Deno.test("forecastEntryFor: void/draft are excluded", () => {
  assertEquals(forecastEntryFor(inv({ status: "void" }), "X"), undefined);
  assertEquals(forecastEntryFor(inv({ status: "draft" }), "X"), undefined);
});

Deno.test("forecastEntryFor: sent without dueDate is excluded (no land date to forecast)", () => {
  assertEquals(
    forecastEntryFor(inv({ status: "sent", dueDate: undefined }), "X"),
    undefined,
  );
});

// REQ-243 (demo quote-invoice-money-m3 d/e): the /invoices hero read "All
// clear — nothing outstanding" over a waiting claim, and kept showing money
// "expected this week" after it was paid. The forward window compared the
// land DAY at noon UTC against the current instant, so a same-day claim made
// in the afternoon fell out of "this week", and a payment recorded in the
// morning was counted as money still to come.
function forecastWith(invoices: Invoice[]) {
  const stores = {
    invoices: { listByUser: () => Promise.resolve(invoices) },
    customers: { getOwned: () => Promise.reject(new Error("none")) },
    quotes: { getOwned: () => Promise.reject(new Error("none")) },
  };
  return new ComputeInvoiceForecast(
    stores.invoices as unknown as ConstructorParameters<
      typeof ComputeInvoiceForecast
    >[0],
    stores.customers as unknown as ConstructorParameters<
      typeof ComputeInvoiceForecast
    >[1],
    stores.quotes as unknown as ConstructorParameters<
      typeof ComputeInvoiceForecast
    >[2],
  );
}

Deno.test("REQ-243: a same-day Zelle claim made this afternoon is money expected this week", async () => {
  const now = new Date("2026-05-10T18:00:00Z");
  const r = await forecastWith([
    inv({
      id: "claimed-1",
      status: "claimed",
      paymentIntent: {
        method: "zelle",
        amount: 100_00,
        claimedAt: "2026-05-10T15:00:00Z",
      },
    }),
  ]).run("u-1", now);
  assertEquals(r.thisWeek.map((e) => e.invoiceId), ["claimed-1"]);
  assertEquals(r.thisWeekCents, 100_00);
});

Deno.test("REQ-243: an invoice paid this morning is not money still expected this week", async () => {
  const now = new Date("2026-05-10T09:00:00Z");
  const r = await forecastWith([
    inv({ id: "paid-1", status: "paid", paidAt: "2026-05-10T08:30:00Z" }),
  ]).run("u-1", now);
  assertEquals(r.thisWeek, []);
  assertEquals(r.thisWeekCents, 0);
  assertEquals(r.nextWeekCents, 0);
});

Deno.test("REQ-243: a sent invoice due later today is still expected this week", async () => {
  const now = new Date("2026-05-10T20:00:00Z");
  const r = await forecastWith([
    inv({ id: "due-today", status: "sent", dueDate: "2026-05-10" }),
  ]).run("u-1", now);
  assertEquals(r.thisWeek.map((e) => e.invoiceId), ["due-today"]);
  assertEquals(r.atRiskCents, 0);
});

// REQ-484 (demo-loop cycle 3, m12): "this week" is the calendar week —
// today through Sunday — and "next week" is the Monday–Sunday after it.
// The rolling, inclusive today..today+7 window called a Nov 19 due date
// "expected this week" on Thursday Nov 12.
Deno.test("REQ-484 m12: on Thu Nov 12 an invoice due Thu Nov 19 (today+7) is next week, not this week", async () => {
  const now = new Date("2026-11-12T15:00:00Z"); // a Thursday
  const r = await forecastWith([
    inv({
      id: "due-19",
      status: "sent",
      dueDate: "2026-11-19",
      amount: 500_00,
    }),
  ]).run("u-1", now);
  assertEquals(r.thisWeek, []);
  assertEquals(r.thisWeekCents, 0);
  assertEquals(r.nextWeekCents, 500_00);
});

Deno.test("REQ-484 m12: this week runs through Sunday; next week is the following Monday–Sunday", async () => {
  const now = new Date("2026-11-12T15:00:00Z"); // Thursday
  const r = await forecastWith([
    inv({ id: "sun", status: "sent", dueDate: "2026-11-15", amount: 1_00 }),
    inv({ id: "mon", status: "sent", dueDate: "2026-11-16", amount: 10_00 }),
    inv({
      id: "next-sun",
      status: "sent",
      dueDate: "2026-11-22",
      amount: 100_00,
    }),
    inv({
      id: "later",
      status: "sent",
      dueDate: "2026-11-23",
      amount: 1000_00,
    }),
  ]).run("u-1", now);
  assertEquals(r.thisWeek.map((e) => e.invoiceId), ["sun"]);
  assertEquals(r.thisWeekCents, 1_00);
  assertEquals(r.nextWeekCents, 110_00);
});

Deno.test("REQ-484 m12: on a Sunday, this week is just today and Monday starts next week", async () => {
  const now = new Date("2026-11-15T10:00:00Z"); // Sunday
  const r = await forecastWith([
    inv({ id: "today", status: "sent", dueDate: "2026-11-15", amount: 1_00 }),
    inv({ id: "mon", status: "sent", dueDate: "2026-11-16", amount: 10_00 }),
    inv({
      id: "next-sun",
      status: "sent",
      dueDate: "2026-11-22",
      amount: 100_00,
    }),
    inv({
      id: "later",
      status: "sent",
      dueDate: "2026-11-23",
      amount: 1000_00,
    }),
  ]).run("u-1", now);
  assertEquals(r.thisWeek.map((e) => e.invoiceId), ["today"]);
  assertEquals(r.nextWeekCents, 110_00);
});
