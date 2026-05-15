import { assertEquals } from "#std/assert";
import { forecastEntryFor, settlementOffsetDays } from "./mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

function inv(overrides: Partial<Invoice>): Invoice {
  return {
    id: "i-1",
    userId: "u-1",
    contractId: "c-1",
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
  const e = forecastEntryFor(inv({ status: "paid", paidAt: "2026-05-10T00:00:00Z" }), "Hansen");
  assertEquals(e?.expectedLandDate, "2026-05-10");
  assertEquals(e?.source, "paid");
});

Deno.test("forecastEntryFor: claimed ACH lands claimedAt + 2 days", () => {
  const e = forecastEntryFor(
    inv({
      status: "claimed",
      paymentIntent: { method: "ach", amount: 100_00, claimedAt: "2026-05-10T00:00:00Z" },
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
      paymentIntent: { method: "check", amount: 100_00, claimedAt: "2026-05-10T00:00:00Z" },
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
      paymentIntent: { method: "venmo", amount: 50_00, claimedAt: "2026-05-10T15:00:00Z" },
    }),
    "Hans",
  );
  assertEquals(e?.expectedLandDate, "2026-05-10");
});

Deno.test("forecastEntryFor: sent invoices use dueDate, source='sent_due'", () => {
  const e = forecastEntryFor(inv({ status: "sent", dueDate: "2026-05-21" }), "Hawthorne");
  assertEquals(e?.expectedLandDate, "2026-05-21");
  assertEquals(e?.source, "sent_due");
});

Deno.test("forecastEntryFor: scheduled invoices are excluded from forecast", () => {
  // scheduled invoices are placeholder pipeline, not forecast revenue.
  const e = forecastEntryFor(inv({ status: "scheduled", scheduledFor: "2026-05-15" }), "X");
  assertEquals(e, undefined);
});

Deno.test("forecastEntryFor: void/draft are excluded", () => {
  assertEquals(forecastEntryFor(inv({ status: "void" }), "X"), undefined);
  assertEquals(forecastEntryFor(inv({ status: "draft" }), "X"), undefined);
});

Deno.test("forecastEntryFor: sent without dueDate is excluded (no land date to forecast)", () => {
  assertEquals(forecastEntryFor(inv({ status: "sent", dueDate: undefined }), "X"), undefined);
});
