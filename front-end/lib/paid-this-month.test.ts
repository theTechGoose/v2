/**
 * REQ-959 — LOOP-007 cycle 1, q1-34 [BUG_CONTRADICTION]: "Invoices and
 * Payments pages disagree on this month's money". Raphael: "test every
 * single aspect of this application … one Opus agent per issue to do root
 * cause analysis, then one to write the test, then one to fix it and make
 * it green."
 *
 * Unit level: /invoices "Paid this month" and the /payments hero must come
 * from ONE helper in headline-counts.ts — `paidThisMonthCents(payments,
 * invoices, monthStart)` → `{ cents, clearedCount }` (or plain cents) — so a
 * part payment counts on both. The second test pins the bug itself: the
 * per-invoice reduction /invoices runs today (stage "paid" + paidAt this
 * month, then paidKpiInvoiceCents) must equal the /payments sum
 * (creditedPayments over this month's landed payments).
 */
import { assert, assertEquals } from "@std/assert";
import * as hc from "./headline-counts.ts";

const monthStart = new Date(2026, 10, 1); // Nov 1 2026, local
const inMonth = new Date(2026, 10, 10, 12).toISOString();

// INV-001 $2,489.75 paid in full; INV-002 $1,000 with a $400 check.
const invoices = [
  {
    id: "inv-1",
    amount: 248975,
    paidCents: 248975,
    status: "paid",
    paidAt: inMonth,
  },
  { id: "inv-2", amount: 100000, paidCents: 40000, status: "sent" },
];
const payments = [
  {
    id: "p-1",
    invoiceId: "inv-1",
    amount: 248975,
    receivedAt: inMonth,
    status: "landed",
  },
  {
    id: "p-2",
    invoiceId: "inv-2",
    amount: 40000,
    receivedAt: inMonth,
    status: "landed",
  },
];

/** What /payments' hero sums today (PaymentsPage.tsx monthTotal). */
function paymentsHeroCents(): number {
  const credited = hc.creditedPayments(payments, invoices);
  return payments
    .filter((p) =>
      p.status === "landed" && new Date(p.receivedAt) >= monthStart
    )
    .reduce((s, p) => s + (credited.get(p.id)?.creditedCents ?? p.amount), 0);
}

Deno.test("REQ-959 (q1-34): one shared paidThisMonthCents helper counts the $400 part payment — 288975, same as /payments", () => {
  const helper = (hc as Record<string, unknown>).paidThisMonthCents;
  assert(
    typeof helper === "function",
    "headline-counts.ts exports no paidThisMonthCents — /invoices and /payments each compute 'paid this month' their own way",
  );
  const r = (helper as (
    p: typeof payments,
    i: typeof invoices,
    m: Date,
  ) => number | { cents: number; clearedCount?: number })(
    payments,
    invoices,
    monthStart,
  );
  const cents = typeof r === "number" ? r : r.cents;
  assertEquals(cents, 288975);
  assertEquals(cents, paymentsHeroCents());
  if (typeof r !== "number" && r.clearedCount !== undefined) {
    assertEquals(r.clearedCount, 1, "one bill paid in full");
  }
});

Deno.test("REQ-959 (q1-34): the /invoices 'Paid this month' reduction equals the /payments hero for a part-paid invoice", async () => {
  // InvoicesPage.tsx: the tile's value. Once the page delegates to the
  // shared helper this reads it; until then it mirrors today's inline code.
  const src = await Deno.readTextFile(
    new URL("../islands/InvoicesPage.tsx", import.meta.url),
  );
  const usesHelper = /paidThisMonthCents\s*\(/.test(src);
  const helper = (hc as Record<string, unknown>).paidThisMonthCents as
    | ((
      p: unknown,
      i: unknown,
      m: Date,
    ) => number | { cents: number })
    | undefined;
  const invoicesTile = usesHelper && helper
    ? (() => {
      const r = helper(payments, invoices, monthStart);
      return typeof r === "number" ? r : r.cents;
    })()
    : invoices
      .filter((i) =>
        (i.status === "paid" || !!i.paidAt) && i.paidAt &&
        new Date(i.paidAt) >= monthStart
      )
      .reduce((s, i) => s + hc.paidKpiInvoiceCents(i), 0);
  assertEquals(
    invoicesTile,
    paymentsHeroCents(),
    "/invoices 'Paid this month' must equal /payments 'showed up this month'",
  );
});
