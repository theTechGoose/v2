/**
 * REQ-1128 — LOOP-007 cycle 3, issue q3-56 [minor/BUG_CONTRADICTION]: "CSV
 * export calls an invoice due today 'overdue'; the app says it isn't".
 *
 * QA, at 2026-11-19T12:34Z: INV-002 (due 2026-11-19, part-paid, stored
 * "pending") exported with Status "overdue", while /invoices listed it under
 * "Out for payment" and /i said nothing was past due. The CSV reads
 * invoiceDisplayStatus → isInvoiceOverdue, which compares the instant
 * new Date("2026-11-19") — midnight UTC at the START of the due day — with
 * now. /i (isPastDue) and the /invoices card (due < today) both count the
 * whole due day as not yet overdue. One rule: overdue only once the due day
 * has ended.
 */
import {
  invoiceDisplayStatus,
  invoicePillFlags,
  isInvoiceOverdue,
  isPastDue,
} from "../../shared/documents/invoice-status";
import { invoiceExportRow } from "../../shared/documents/exports";

const DUE = "2026-11-19";
const MIDDAY = new Date("2026-11-19T12:34:00.000Z");
const FIRST_SECOND = new Date("2026-11-19T00:00:01.000Z");
const NEXT_DAY = new Date("2026-11-20T00:00:01.000Z");

/** INV-002 as the store holds it: $500 of $1,200 paid, due today */
const partPaid = {
  id: "i2",
  number: "INV-002",
  seq: 2,
  status: "pending",
  amount: 120000,
  paidCents: 50000,
  issuedDate: "2026-11-01",
  dueDate: DUE,
  createdAt: "2026-11-01",
};
const unpaidSent = { ...partPaid, status: "sent", paidCents: 0 };

describe("REQ-1128 (LOOP-007 q3-56) an invoice due today is not overdue — CSV, urgency rule and /i agree", () => {
  test("REQ-1128 isInvoiceOverdue: due 2026-11-19 at 12:34Z on the due day → false (agrees with isPastDue)", () => {
    expect(isPastDue(DUE, MIDDAY)).toBe(false);
    expect(isInvoiceOverdue(partPaid, MIDDAY)).toBe(false);
  });

  test("REQ-1128 isInvoiceOverdue: at the due day's first second (00:00:01Z) → false", () => {
    expect(isInvoiceOverdue(unpaidSent, FIRST_SECOND)).toBe(false);
  });

  test("REQ-1128 isInvoiceOverdue and isPastDue agree on every instant around the due day", () => {
    for (
      const now of [
        new Date("2026-11-18T23:59:59.000Z"),
        FIRST_SECOND,
        MIDDAY,
        new Date("2026-11-19T23:59:58.000Z"),
        NEXT_DAY,
      ]
    ) {
      expect([now.toISOString(), isInvoiceOverdue(unpaidSent, now)]).toEqual([
        now.toISOString(),
        isPastDue(DUE, now),
      ]);
    }
  });

  test("REQ-1128 CSV Status: a part-paid invoice due today reads 'partly paid' (as /i's pill), not 'overdue'", () => {
    expect(invoicePillFlags(partPaid, MIDDAY).pastDue).toBe(false);
    expect(invoiceDisplayStatus(partPaid, MIDDAY)).toBe("partly paid");
    expect(
      invoiceExportRow(partPaid, { changeOrders: [], link: "", now: MIDDAY })[2],
    ).toBe("partly paid");
  });

  test("REQ-1128 CSV Status: an unpaid 'sent' invoice due today reads 'sent', not 'overdue'", () => {
    expect(invoiceDisplayStatus(unpaidSent, MIDDAY)).toBe("sent");
  });

  test("REQ-1128 once the due day has ended (2026-11-20T00:00:01Z) both read 'overdue'", () => {
    expect(isInvoiceOverdue(partPaid, NEXT_DAY)).toBe(true);
    expect(invoiceDisplayStatus(partPaid, NEXT_DAY)).toBe("overdue");
    expect(invoiceDisplayStatus(unpaidSent, NEXT_DAY)).toBe("overdue");
  });
});
