/**
 * REQ-205 — the quote's ledger, pure: what was agreed, what was invoiced,
 * what was paid, what is still owed on sent invoices, and what remains to
 * be invoiced. "Remaining to invoice" and "invoiced but unpaid" are two
 * different numbers and never mixed. Approved change orders are part of
 * the agreed total.
 *
 * All amounts are INTEGER CENTS.
 */
import { invoiceBalance, isInvoiceIssued, versionOf } from "./versions.ts";
import { docNumberOf } from "./numbering.ts";

export interface LedgerQuote {
  id: string;
  number?: string;
  version?: number;
  status?: string;
  acceptedAt?: string;
  estimatedTotal?: number;
  lineItems?: Array<{ price?: number; quantity?: number }>;
}

export interface LedgerInvoice {
  id: string;
  number?: string;
  seq?: number;
  version?: number;
  status?: string;
  amount?: number;
  paidCents?: number;
  dueDate?: string;
  paidAt?: string;
  /** REQ-481: the day a scheduled installment sends itself */
  scheduledFor?: string;
  installmentIndex?: number;
  installmentTotal?: number;
  createdAt?: string;
}

export interface LedgerChangeOrder {
  id: string;
  number?: string;
  version?: number;
  status?: string;
  deltaAmountCents: number;
  description?: string;
  invoiceId?: string;
  decidedAt?: string;
}

export interface LedgerWorkOrder {
  id: string;
  number?: string;
  version?: number;
  status?: string;
  description?: string;
  scheduledFor?: string;
  completedOn?: string;
  assignee?: string;
  invoiceId?: string;
}

export interface LedgerWorkOrderRow {
  id: string;
  number: string;
  version: number;
  status: string;
  description?: string;
  scheduledFor?: string;
  completedOn?: string;
  assignee?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  url: string;
}

/** Invoice statuses whose amount is NOT committed against the agreement. */
const FREED = new Set(["void", "canceled"]);

export interface LedgerInvoiceRow {
  id: string;
  number: string;
  version: number;
  status: string;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  overpaidCents: number;
  dueDate?: string;
  paidAt?: string;
  /** REQ-481: the day a scheduled installment sends itself */
  scheduledFor?: string;
  installmentIndex?: number;
  installmentTotal?: number;
  url: string;
}

export interface LedgerChangeOrderRow {
  id: string;
  number: string;
  version: number;
  status: string;
  deltaAmountCents: number;
  description?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  decidedAt?: string;
  url: string;
}

export interface QuoteLedger {
  quote: {
    id: string;
    number: string;
    version: number;
    status?: string;
    accepted: boolean;
    url: string;
  };
  /** the quote's own total, before change orders */
  quoteTotalCents: number;
  /** approved change orders, summed */
  approvedChangeOrdersCents: number;
  /** what was agreed: quote total + approved change orders */
  agreementTotalCents: number;
  /** every non-void invoice, summed — sent or not yet sent (what the
   *  agreement cap and "remaining to invoice" count against) */
  invoicedCents: number;
  /** REQ-481: the issued (in front of the customer) part of invoicedCents */
  billedCents: number;
  /** REQ-481: the not-yet-sent part — scheduled installments and drafts */
  scheduledCents: number;
  /** REQ-481: the first not-yet-sent invoice, when there is one */
  nextScheduled?: {
    id: string;
    number: string;
    amountCents: number;
    scheduledFor?: string;
  };
  /** confirmed payments across those invoices */
  paidCents: number;
  /** invoiced but not yet paid — the open balances of ISSUED invoices only
   *  (REQ-481: a scheduled installment is not owed yet) */
  invoicedUnpaidCents: number;
  /** agreement total not yet put on any invoice */
  remainingToInvoiceCents: number;
  /** payments beyond an invoice's amount, summed (REQ-202: flagged, never hidden) */
  overpaidCents: number;
  invoices: LedgerInvoiceRow[];
  changeOrders: LedgerChangeOrderRow[];
  /** REQ-210: the work orders raised for this agreement (contractor-side) */
  workOrders: LedgerWorkOrderRow[];
}

export function quoteTotalCents(
  q: Pick<LedgerQuote, "estimatedTotal" | "lineItems">,
): number {
  if (typeof q.estimatedTotal === "number") {
    return Math.max(0, Math.round(q.estimatedTotal));
  }
  return (q.lineItems ?? []).reduce(
    (s, li) => s + Math.round((li.price ?? 0) * (li.quantity ?? 1)),
    0,
  );
}

/**
 * REQ-679 (demo-loop cycle 5, M18 + M19): the agreed total — the quote's
 * own total plus its APPROVED change orders (pending and declined ones are
 * not agreed). Approving an order revises only its invoice; every surface
 * that names the agreement (the ledger, /i, the invoice PDF and email, the
 * /quotes panel header, the dashboard's job rows) reads this one rule.
 */
export function approvedChangeOrdersCents(
  changeOrders: readonly { status?: string; deltaAmountCents: number }[],
): number {
  return changeOrders
    .filter((c) => c.status === "approved")
    .reduce((s, c) => s + Math.round(c.deltaAmountCents), 0);
}

export function agreedTotalCents(
  quote: Pick<LedgerQuote, "estimatedTotal" | "lineItems">,
  changeOrders: readonly { status?: string; deltaAmountCents: number }[],
): number {
  return Math.max(
    0,
    quoteTotalCents(quote) + approvedChangeOrdersCents(changeOrders),
  );
}

/** REQ-679: one installment of the agreement, as the schedule reads it. */
export interface ScheduleInstallment {
  id?: string;
  amount?: number;
  status?: string;
  installmentIndex?: number;
  installmentTotal?: number;
}

/**
 * REQ-679 (M18): the payment schedule's amounts from the REAL installments.
 * `split` is the agreed total split by the payment terms (one amount per
 * milestone). An installment of the same plan (installmentTotal ===
 * split.length, 1-based installmentIndex, not void) puts its own amount in
 * its slot — an approved change order lands on the invoice it revised, not
 * evenly across the plan. The slots no installment covers yet share what is
 * left of the agreement, in proportion to the split. With nothing known (or
 * a single-payment plan) the split is returned as given.
 */
export function installmentSchedule(
  split: readonly number[],
  agreedCents: number,
  installments: readonly ScheduleInstallment[],
): number[] {
  const n = split.length;
  if (n < 2) return split.slice();
  const known = new Map<number, number>();
  for (const i of installments) {
    if (FREED.has(i.status ?? "")) continue;
    if (i.installmentTotal !== n || typeof i.amount !== "number") continue;
    const idx = i.installmentIndex ?? 0;
    if (idx < 1 || idx > n) continue;
    known.set(idx, Math.round(i.amount));
  }
  if (known.size === 0) return split.slice();
  const out = split.map((s, k) => known.get(k + 1) ?? s);
  const open = split.map((_, k) => k).filter((k) => !known.has(k + 1));
  if (open.length === 0) return out;
  const knownSum = [...known.values()].reduce((s, a) => s + a, 0);
  const left = Math.max(0, Math.round(agreedCents) - knownSum);
  const weight = open.reduce((s, k) => s + Math.max(0, split[k]), 0);
  let given = 0;
  open.forEach((k, j) => {
    const share = j === open.length - 1
      ? left - given
      : weight > 0
      ? Math.round((left * Math.max(0, split[k])) / weight)
      : 0;
    out[k] = share;
    given += share;
  });
  return out;
}

/**
 * REQ-679 (M19): the /quotes panel header's money — the ledger's agreement
 * total (and the approved change orders in it, for the "incl. +$X in change
 * orders" line), else the card's own approved change orders over the quote.
 */
export function panelAgreedTotal(
  quote: Pick<LedgerQuote, "estimatedTotal" | "lineItems"> & {
    approvedChangeOrdersCents?: number;
  },
  ledger?:
    | Pick<QuoteLedger, "agreementTotalCents" | "approvedChangeOrdersCents">
    | null,
): { totalCents: number; changeOrdersCents: number } {
  if (ledger) {
    return {
      totalCents: ledger.agreementTotalCents,
      changeOrdersCents: ledger.approvedChangeOrdersCents,
    };
  }
  const co = quote.approvedChangeOrdersCents ?? 0;
  return {
    totalCents: Math.max(0, quoteTotalCents(quote) + co),
    changeOrdersCents: co,
  };
}

export function quoteLedger(
  quote: LedgerQuote,
  invoices: readonly LedgerInvoice[],
  changeOrders: readonly LedgerChangeOrder[],
  workOrders: readonly LedgerWorkOrder[] = [],
): QuoteLedger {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const rows: LedgerInvoiceRow[] = invoices
    .slice()
    .sort((a, b) => {
      // number order first (INV-001 before INV-002), then the milestone order, then age
      if (a.seq != null && b.seq != null && a.seq !== b.seq) {
        return a.seq - b.seq;
      }
      const ai = a.installmentIndex ?? 99;
      const bi = b.installmentIndex ?? 99;
      if (ai !== bi) return ai - bi;
      return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    })
    .map((i) => {
      const bal = invoiceBalance(
        i.amount,
        i.paidCents ?? (i.status === "paid" ? (i.amount ?? 0) : 0),
      );
      return {
        id: i.id,
        number: docNumberOf(i),
        version: versionOf(i),
        status: i.status ?? "draft",
        amountCents: bal.amountCents,
        paidCents: bal.paidCents,
        balanceCents: FREED.has(i.status ?? "") ? 0 : bal.balanceCents,
        overpaidCents: bal.overpaidCents,
        ...(i.dueDate ? { dueDate: i.dueDate } : {}),
        ...(i.paidAt ? { paidAt: i.paidAt } : {}),
        ...(i.scheduledFor ? { scheduledFor: i.scheduledFor } : {}),
        ...(i.installmentIndex != null
          ? { installmentIndex: i.installmentIndex }
          : {}),
        ...(i.installmentTotal != null
          ? { installmentTotal: i.installmentTotal }
          : {}),
        url: `/i/${i.id}`,
      };
    });
  const coRows: LedgerChangeOrderRow[] = changeOrders
    .slice()
    .sort((a, b) => (a.number ?? "").localeCompare(b.number ?? ""))
    .map((co) => ({
      id: co.id,
      number: docNumberOf(co),
      version: versionOf(co),
      status: co.status ?? "pending",
      deltaAmountCents: Math.round(co.deltaAmountCents),
      ...(co.description ? { description: co.description } : {}),
      ...(co.invoiceId ? { invoiceId: co.invoiceId } : {}),
      ...(co.invoiceId && byId.get(co.invoiceId)
        ? { invoiceNumber: docNumberOf(byId.get(co.invoiceId)!) }
        : {}),
      ...(co.decidedAt ? { decidedAt: co.decidedAt } : {}),
      url: `/co/${co.id}`,
    }));
  const woRows: LedgerWorkOrderRow[] = workOrders
    .slice()
    .sort((a, b) => (a.number ?? "").localeCompare(b.number ?? ""))
    .map((wo) => ({
      id: wo.id,
      number: docNumberOf(wo),
      version: versionOf(wo),
      status: wo.status ?? "open",
      ...(wo.description ? { description: wo.description } : {}),
      ...(wo.scheduledFor ? { scheduledFor: wo.scheduledFor } : {}),
      ...(wo.completedOn ? { completedOn: wo.completedOn } : {}),
      ...(wo.assignee ? { assignee: wo.assignee } : {}),
      ...(wo.invoiceId ? { invoiceId: wo.invoiceId } : {}),
      ...(wo.invoiceId && byId.get(wo.invoiceId)
        ? { invoiceNumber: docNumberOf(byId.get(wo.invoiceId)!) }
        : {}),
      url: `/wo/${wo.id}`,
    }));
  const quoteTotal = quoteTotalCents(quote);
  const approved = approvedChangeOrdersCents(coRows);
  const agreement = agreedTotalCents(quote, coRows); // REQ-679
  const live = rows.filter((r) => !FREED.has(r.status));
  const invoiced = live.reduce((s, r) => s + r.amountCents, 0);
  // REQ-481 (demo M28): a scheduled installment or a draft is committed
  // against the agreement but not billed — never "invoiced but unpaid".
  const issued = live.filter((r) => isInvoiceIssued(r));
  const unsent = live.filter((r) => !isInvoiceIssued(r));
  const billed = issued.reduce((s, r) => s + r.amountCents, 0);
  const next =
    unsent.slice().sort((a, b) =>
      (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999")
    )[0];
  const paid = live.reduce((s, r) => s + r.paidCents, 0);
  const unpaid = issued.reduce((s, r) => s + r.balanceCents, 0);
  const overpaid = live.reduce((s, r) => s + r.overpaidCents, 0);
  return {
    quote: {
      id: quote.id,
      number: docNumberOf(quote),
      version: versionOf(quote),
      ...(quote.status ? { status: quote.status } : {}),
      accepted: quote.status === "accepted" || Boolean(quote.acceptedAt),
      url: `/q/${quote.id}`,
    },
    quoteTotalCents: quoteTotal,
    approvedChangeOrdersCents: approved,
    agreementTotalCents: agreement,
    invoicedCents: invoiced,
    billedCents: billed,
    scheduledCents: invoiced - billed,
    ...(next
      ? {
        nextScheduled: {
          id: next.id,
          number: next.number,
          amountCents: next.amountCents,
          ...(next.scheduledFor ? { scheduledFor: next.scheduledFor } : {}),
        },
      }
      : {}),
    paidCents: paid,
    invoicedUnpaidCents: unpaid,
    remainingToInvoiceCents: Math.max(0, agreement - invoiced),
    overpaidCents: overpaid,
    invoices: rows,
    changeOrders: coRows,
    workOrders: woRows,
  };
}

/* ---------------- REQ-233: never bill past the agreement ---------------- */

export type InvoiceCapDecision =
  | { ok: true; remainingCents: number }
  | {
    ok: false;
    reason: "exceeds_agreement";
    agreementTotalCents: number;
    invoicedCents: number;
    remainingCents: number;
    requestedCents: number;
  };

/**
 * REQ-233 (demo B2): may a NEW invoice on this quote bill `requestedCents`?
 * Only up to the ledger's remaining-to-invoice (quote total + approved change
 * orders − every non-void invoice on the quote). Tax is not part of the
 * agreed price, so it is left out of the request (`requestedTaxCents`) and of
 * each billed invoice (`taxCents`). A quote with no agreed price is not capped.
 */
export function invoiceCapDecision(
  quote: LedgerQuote,
  invoices: readonly (LedgerInvoice & { taxCents?: number })[],
  changeOrders: readonly LedgerChangeOrder[],
  requestedCents: number,
  requestedTaxCents = 0,
): InvoiceCapDecision {
  const pretax = invoices.map((i) => ({
    ...i,
    amount: Math.max(0, (i.amount ?? 0) - Math.max(0, i.taxCents ?? 0)),
  }));
  const l = quoteLedger(quote, pretax, changeOrders);
  const requested = Math.max(
    0,
    Math.round(requestedCents) - Math.max(0, Math.round(requestedTaxCents)),
  );
  if (l.agreementTotalCents <= 0 || requested <= l.remainingToInvoiceCents) {
    return { ok: true, remainingCents: l.remainingToInvoiceCents };
  }
  return {
    ok: false,
    reason: "exceeds_agreement",
    agreementTotalCents: l.agreementTotalCents,
    invoicedCents: l.invoicedCents,
    remainingCents: l.remainingToInvoiceCents,
    requestedCents: requested,
  };
}

/**
 * REQ-233: what the assistant's Quote ⇄ Invoice swap may bill for a quote
 * whose total is `totalCents` and whose ledger still has `remainingCents`
 * unbilled — the remainder, never more than the total; null when the
 * agreement is already fully billed (no new invoice at all).
 */
export function swapInvoiceCents(
  totalCents: number,
  remainingCents: number,
): number | null {
  const amount = Math.min(
    Math.max(0, Math.round(totalCents)),
    Math.max(0, Math.round(remainingCents)),
  );
  return amount > 0 ? amount : null;
}

/** REQ-233: is this thrown API error the agreement cap's 409? */
export function isExceedsAgreement(err: unknown): boolean {
  const e = err as { status?: unknown; body?: unknown } | null;
  const body = e?.body as { reason?: unknown } | null | undefined;
  return e?.status === 409 && body?.reason === "exceeds_agreement";
}
