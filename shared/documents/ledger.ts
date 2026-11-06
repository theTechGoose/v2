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

export function quoteTotalCents(q: LedgerQuote): number {
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
