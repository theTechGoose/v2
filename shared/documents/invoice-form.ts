/**
 * REQ-206 (standalone invoice form) / REQ-201 (number · version · state) /
 * REQ-202 (one balance) / REQ-205 (prefill from the quote's ledger) — pure.
 *
 * Everything the contractor dashboard needs to build an invoice on its own:
 * dollars ↔ cents, percent ↔ basis points, the subtotal / discount / tax /
 * total arithmetic, the due date from the payment terms, the "what's
 * missing" prompt list (a warning, never a gate), the POST body, the
 * ledger → form prefill, and the headline a card shows next to its number.
 * No I/O, no DOM, no dates read from the clock — the caller passes "today".
 */
import { docNumberOf } from "./numbering.ts";
import {
  type DocState,
  invoiceBalance,
  invoiceState,
  versionOf,
} from "./versions.ts";

/* ---------------- money ---------------- */

/** "12.50" / " 1,250.75 " → 1250 / 125075. Empty, junk or negative → 0. */
export function dollarsToCents(
  raw: string | number | null | undefined,
): number {
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === "number"
    ? raw
    : Number(String(raw).replace(/[,\s$]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** 1250 → "12.50" (an input's value). Missing → "". */
export function centsToDollars(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  return (Math.round(cents) / 100).toFixed(2);
}

/** "8.25" → 825 basis points. Junk → 0. */
export function percentToBp(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === "number"
    ? raw
    : Number(String(raw).replace(/[%\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** 825 → "8.25", 700 → "7" (an input's value). */
export function bpToPercent(bp: number | null | undefined): string {
  if (typeof bp !== "number" || !Number.isFinite(bp) || bp <= 0) return "0";
  const s = (bp / 100).toFixed(2);
  return s.replace(/\.?0+$/, "");
}

/* ---------------- lines + totals ---------------- */

export interface FormLine {
  description: string;
  quantity: number;
  unit?: string;
  /** INTEGER CENTS per unit */
  price: number;
}

export function lineTotalCents(line: FormLine): number {
  const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
  const price = Number.isFinite(line.price) ? line.price : 0;
  return Math.max(0, Math.round(qty * price));
}

export interface TotalsInput {
  lineItems: FormLine[];
  /** used as the subtotal when there are no lines (the quick one-amount bill) */
  amountCents?: number;
  discountCents?: number;
  taxRateBp?: number;
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
}

/** Subtotal − discount, then tax on what is left. Never below zero. */
export function computeTotals(input: TotalsInput): Totals {
  const subtotalCents = input.lineItems.length > 0
    ? input.lineItems.reduce((sum, l) => sum + lineTotalCents(l), 0)
    : Math.max(0, Math.round(input.amountCents ?? 0));
  const discountCents = Math.max(0, Math.round(input.discountCents ?? 0));
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const bp = Math.max(0, Math.round(input.taxRateBp ?? 0));
  const taxCents = Math.round(taxableCents * bp / 10_000);
  return {
    subtotalCents,
    discountCents,
    taxableCents,
    taxCents,
    totalCents: taxableCents + taxCents,
  };
}

/* ---------------- terms ---------------- */

export const NET_DAYS_OPTIONS = [0, 7, 15, 30] as const;

/** yyyy-mm-dd + n calendar days (UTC arithmetic — no DST drift). */
export function dueDateFrom(issuedDate: string, netDays: number): string {
  const d = new Date(`${issuedDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return issuedDate;
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.trunc(netDays)));
  return d.toISOString().slice(0, 10);
}

/* ---------------- bill-to ---------------- */

export interface BillTo {
  name: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  address: string;
}

export const EMPTY_BILL_TO: BillTo = {
  name: "",
  businessName: "",
  email: "",
  phoneNumber: "",
  address: "",
};

/** The customer's details, as the form's editable bill-to fields. */
export function billToFromCustomer(
  c:
    | {
      name?: string;
      businessName?: string;
      email?: string;
      phoneNumber?: string;
      address?: string;
    }
    | null
    | undefined,
): BillTo {
  return {
    name: c?.name ?? "",
    businessName: c?.businessName ?? "",
    email: c?.email ?? "",
    phoneNumber: c?.phoneNumber ?? "",
    address: c?.address ?? "",
  };
}

/* ---------------- missing info ---------------- */

export type MissingInfo =
  | "noBillingName"
  | "noBillingEmail"
  | "noServiceAddress"
  | "noLineItems"
  | "noAmount";

/** What the bill still lacks — a prompt before sending, never a block. */
export function missingInfo(form: {
  billTo: Pick<BillTo, "name" | "email" | "address">;
  serviceAddress: string;
  lineItems: FormLine[];
  amountCents: number;
}): MissingInfo[] {
  const out: MissingInfo[] = [];
  if (!form.billTo.name.trim()) out.push("noBillingName");
  if (!form.billTo.email.trim()) out.push("noBillingEmail");
  if (!form.serviceAddress.trim() && !form.billTo.address.trim()) {
    out.push("noServiceAddress");
  }
  // REQ-486 (m32): an amount with no lines is the supported quick bill (the
  // typed total) — only an empty bill lacks line items.
  if (form.lineItems.length === 0 && form.amountCents <= 0) {
    out.push("noLineItems");
  }
  if (form.amountCents <= 0) out.push("noAmount");
  return out;
}

/* ---------------- POST body ---------------- */

export interface InvoiceFormValues {
  customerId?: string;
  quoteId?: string;
  jobName: string;
  description: string;
  lineItems: FormLine[];
  /** the typed total when there are no lines */
  amountCents?: number;
  discountCents: number;
  discountReason: string;
  taxRateBp: number;
  netDays: number;
  issuedDate: string;
  /** when set it wins over issuedDate + netDays (the custom terms) */
  dueDate?: string;
  serviceAddress: string;
  serviceDateFrom?: string;
  serviceDateTo?: string;
  paymentInstructions: string;
  billTo: BillTo;
}

function nonEmpty(s: string | undefined): string | undefined {
  const v = (s ?? "").trim();
  return v ? v : undefined;
}

/** The POST /invoices body for the form: cents, basis points, trimmed strings, nothing empty. */
export function buildInvoiceBody(
  form: InvoiceFormValues,
  opts: {
    requestId: string;
    status: "draft" | "sent" | "scheduled";
    scheduledFor?: string;
  },
): Record<string, unknown> {
  const totals = computeTotals(form);
  const billTo = Object.fromEntries(
    Object.entries(form.billTo).filter(([_, v]) =>
      typeof v === "string" && v.trim()
    )
      .map(([k, v]) => [k, (v as string).trim()]),
  );
  const body: Record<string, unknown> = {
    requestId: opts.requestId,
    status: opts.status,
  };
  if (form.customerId) body.customerId = form.customerId;
  if (form.quoteId) body.quoteId = form.quoteId;
  const jobName = nonEmpty(form.jobName);
  if (jobName) body.jobName = jobName;
  const description = nonEmpty(form.description);
  if (description) body.description = description;
  if (form.lineItems.length > 0) {
    body.lineItems = form.lineItems.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      ...(l.unit ? { unit: l.unit } : {}),
      price: l.price,
    }));
  } else {
    // REQ-486 (m32): the quick one-amount bill — "What's it for" (else the
    // description) + the typed amount become one itemized line, so the
    // invoice and the /i page say what was billed. A quote-drawn invoice is
    // left alone: the backend derives the quote's own lines for it.
    const label = jobName ?? description;
    const amountCents = Math.max(0, Math.round(form.amountCents ?? 0));
    if (!form.quoteId && label && amountCents > 0) {
      body.lineItems = [{
        description: label,
        quantity: 1,
        price: amountCents,
      }];
    }
  }
  body.subtotalCents = totals.subtotalCents;
  if (totals.discountCents > 0) {
    body.discountCents = totals.discountCents;
    const reason = nonEmpty(form.discountReason);
    if (reason) body.discountReason = reason;
  }
  if (form.taxRateBp > 0) {
    body.taxRateBp = form.taxRateBp;
    body.taxCents = totals.taxCents;
  }
  body.amount = totals.totalCents;
  body.netDays = form.netDays;
  body.issuedDate = form.issuedDate;
  body.dueDate = form.dueDate ?? dueDateFrom(form.issuedDate, form.netDays);
  if (opts.scheduledFor) body.scheduledFor = opts.scheduledFor;
  const serviceAddress = nonEmpty(form.serviceAddress);
  if (serviceAddress) body.serviceAddress = serviceAddress;
  if (form.serviceDateFrom) body.serviceDateFrom = form.serviceDateFrom;
  if (form.serviceDateTo) body.serviceDateTo = form.serviceDateTo;
  const instructions = nonEmpty(form.paymentInstructions);
  if (instructions) body.paymentInstructions = instructions;
  if (Object.keys(billTo).length > 0) body.billTo = billTo;
  return body;
}

/* ---------------- prefill from the quote's ledger (REQ-205) ---------------- */

export interface LedgerView {
  /** `accepted`: the customer signed (REQ-249); absent reads as not accepted */
  quote: { id: string; number: string; accepted?: boolean };
  agreementTotalCents: number;
  invoicedCents: number;
  remainingToInvoiceCents: number;
}

export interface LedgerPrefill {
  quoteId: string;
  quoteNumber: string;
  /** the customer accepted (signed) the quote — only then is it "agreed" */
  quoteAccepted: boolean;
  customerId?: string;
  jobName?: string;
  amountCents: number;
  agreedCents: number;
  invoicedCents: number;
  remainingCents: number;
}

export function prefillFromLedger(
  ledger: LedgerView,
  quote:
    | { customerId?: string; jobName?: string; summary?: string }
    | null
    | undefined,
): LedgerPrefill {
  const remaining = Math.max(0, Math.round(ledger.remainingToInvoiceCents));
  const jobName = nonEmpty(quote?.jobName) ?? nonEmpty(quote?.summary);
  return {
    quoteId: ledger.quote.id,
    quoteNumber: ledger.quote.number,
    quoteAccepted: ledger.quote.accepted === true,
    ...(quote?.customerId ? { customerId: quote.customerId } : {}),
    ...(jobName ? { jobName } : {}),
    amountCents: remaining,
    agreedCents: Math.max(0, Math.round(ledger.agreementTotalCents)),
    invoicedCents: Math.max(0, Math.round(ledger.invoicedCents)),
    remainingCents: remaining,
  };
}

/** The New invoice modal's copy (REQ-409, demo-loop cycle 2 m39). With no
 *  quote it is the direct bill ("no quote needed"); drawn from a quote it
 *  names the quote, and its total reads "Agreed" only once the customer
 *  accepted it — until then "Quoted", with a not-accepted warning — the
 *  same rule as the ledger panel's agreed/quoted row (REQ-249). */
export interface NewInvoiceCopy {
  introKey: "invoicesPage.new.intro" | "invoicesPage.new.introFromQuote";
  ledgerKey:
    | "invoices.form.originalQuote"
    | "invoices.form.originalQuoteQuoted"
    | null;
  notAcceptedKey: "invoices.form.quoteNotAccepted" | null;
}

export function newInvoiceCopy(
  ledger: Pick<LedgerPrefill, "quoteAccepted"> | null | undefined,
): NewInvoiceCopy {
  if (!ledger) {
    return {
      introKey: "invoicesPage.new.intro",
      ledgerKey: null,
      notAcceptedKey: null,
    };
  }
  return {
    introKey: "invoicesPage.new.introFromQuote",
    ledgerKey: ledger.quoteAccepted
      ? "invoices.form.originalQuote"
      : "invoices.form.originalQuoteQuoted",
    notAcceptedKey: ledger.quoteAccepted
      ? null
      : "invoices.form.quoteNotAccepted",
  };
}

/* ---------------- headline (REQ-201) ---------------- */

export interface InvoiceHeadline {
  number: string;
  version: number;
  state: DocState;
  /** version > 1 and not closed: "Revised invoice — replaces previous version" */
  revised: boolean;
}

export function invoiceHeadline(
  inv: { id: string; number?: string; version?: number; status?: string },
): InvoiceHeadline {
  const state = invoiceState(inv);
  const version = versionOf(inv);
  return {
    number: docNumberOf(inv),
    version,
    state,
    revised: version > 1 && state !== "paid" && state !== "void" &&
      state !== "draft",
  };
}

/** "INV-5000 · Version 2 · Revised invoice — replaces previous version" */
export function formatInvoiceHeadline(
  inv: { id: string; number?: string; version?: number; status?: string },
  labels: Partial<Record<DocState, string>>,
  versionWord: string,
): string {
  const h = invoiceHeadline(inv);
  const label = h.revised
    ? (labels.revised ?? h.state)
    : (labels[h.state] ?? h.state);
  return `${h.number} · ${versionWord} ${h.version} · ${label}`;
}

/* ---------------- payment summary (REQ-202) ---------------- */

export interface PaymentSummary {
  kind: "unpaid" | "partial" | "paid" | "overpaid";
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  overpaidCents: number;
}

export function paymentSummary(
  inv: {
    amount?: number;
    paidCents?: number;
    overpaidCents?: number | null;
    status?: string;
  },
): PaymentSummary {
  const b = invoiceBalance(inv.amount, inv.paidCents ?? 0);
  const overpaidCents = Math.max(
    b.overpaidCents,
    Math.round(inv.overpaidCents ?? 0),
  );
  const paid = inv.status === "paid";
  const kind: PaymentSummary["kind"] = overpaidCents > 0
    ? "overpaid"
    : paid || (b.amountCents > 0 && b.balanceCents === 0)
    ? "paid"
    : b.paidCents > 0
    ? "partial"
    : "unpaid";
  return {
    kind,
    amountCents: b.amountCents,
    paidCents: paid && b.paidCents === 0 ? b.amountCents : b.paidCents,
    balanceCents: paid ? 0 : b.balanceCents,
    overpaidCents,
  };
}
