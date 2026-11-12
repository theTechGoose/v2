/**
 * REQ-205 — the quote's ledger, pure: what was agreed, what was invoiced,
 * what was paid, what is still owed on sent invoices, and what remains to
 * be invoiced. "Remaining to invoice" and "invoiced but unpaid" are two
 * different numbers and never mixed. Approved change orders are part of
 * the agreed total.
 *
 * All amounts are INTEGER CENTS.
 */
import { invoiceBalance, versionOf } from "./versions.ts";
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
  /** every non-void invoice, summed */
  invoicedCents: number;
  /** confirmed payments across those invoices */
  paidCents: number;
  /** invoiced but not yet paid — the open balances */
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
  const approved = coRows.filter((c) => c.status === "approved").reduce(
    (s, c) => s + c.deltaAmountCents,
    0,
  );
  const agreement = Math.max(0, quoteTotal + approved);
  const live = rows.filter((r) => !FREED.has(r.status));
  const invoiced = live.reduce((s, r) => s + r.amountCents, 0);
  const paid = live.reduce((s, r) => s + r.paidCents, 0);
  const unpaid = live.reduce((s, r) => s + r.balanceCents, 0);
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
