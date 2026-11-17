/**
 * REQ-208 — the CSV exports, pure.
 *
 * Two files the contractor downloads from the dashboard: every invoice
 * (or only the paid / the unpaid ones) and every customer. Columns are
 * fixed, amounts are dollars with two decimals, dates are ISO days, the
 * file starts with the UTF-8 BOM so Excel opens accents correctly, and
 * every cell follows RFC 4180 (quoted when it holds a comma, a quote or a
 * line break; interior quotes doubled; rows joined by CRLF).
 *
 * The backend routes resolve the related records (customer, quote, change
 * orders, the public link) and hand them to `invoiceExportRow` /
 * `customerExportRow`; nothing here reads a store.
 */
import { docNumberOf } from "./numbering.ts";
import { invoiceBalance, versionOf } from "./versions.ts";

/** Excel reads a UTF-8 file as such only when it starts with the BOM. */
export const CSV_BOM = "﻿";

/** One cell, RFC 4180: quoted when it holds a comma, a quote or a line break. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(
  cells: ReadonlyArray<string | number | null | undefined>,
): string {
  return cells.map(csvCell).join(",");
}

/** The whole file: BOM, rows joined by CRLF, no trailing line break. */
export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  return CSV_BOM + rows.map(csvLine).join("\r\n");
}

/** Integer cents as dollars, two decimals ("1234.56"); "" when unknown. */
export function dollars(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  return (Math.round(cents) / 100).toFixed(2);
}

/** The ISO day of a stored date ("2026-11-06" from "2026-11-06T10:00:00.000Z"); "" when there is none. */
export function isoDate(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const d = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

// ---- invoices ----

export const INVOICE_EXPORT_HEADER = [
  "Invoice #",
  "Version",
  "Status",
  "Customer #",
  "Customer",
  "Business",
  "Email",
  "Phone",
  "Billing address",
  "Service address",
  "Service from",
  "Service to",
  "Quote #",
  "Change orders",
  "Issued",
  "Due",
  "Paid on",
  "Subtotal",
  "Discount",
  "Tax",
  "Total",
  "Paid",
  "Balance",
  "Overpaid",
  "Link",
] as const;

interface Party {
  name?: string;
  businessName?: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  number?: string;
}

export interface ExportInvoice {
  id: string;
  number?: string;
  version?: number;
  status?: string;
  customerId?: string;
  quoteId?: string;
  amount?: number;
  subtotalCents?: number;
  discountCents?: number;
  taxCents?: number;
  paidCents?: number;
  issuedDate?: string;
  dueDate?: string;
  paidAt?: string;
  createdAt?: string;
  serviceAddress?: string;
  serviceDateFrom?: string;
  serviceDateTo?: string;
  lineItems?: Array<{ price?: number; quantity?: number }>;
  billTo?: Party;
  customerSnapshot?: Party;
}

export interface ExportCustomer extends Party {
  id: string;
  name: string;
  createdAt?: string;
}

export interface ExportQuote {
  id: string;
  number?: string;
  customerId?: string;
}

export interface InvoiceRowContext {
  customer?: ExportCustomer;
  quote?: ExportQuote;
  changeOrders: ReadonlyArray<{ id: string; number?: string }>;
  /** the customer-facing link ("https://documonster.com/i/<id>") */
  link: string;
}

/** What the invoice was paid: the stored sum, else its amount when it is marked paid. */
export function paidCentsOf(
  i: { amount?: number; paidCents?: number; status?: string },
): number {
  if (typeof i.paidCents === "number") return i.paidCents;
  return i.status === "paid" ? i.amount ?? 0 : 0;
}

function subtotalOf(i: ExportInvoice): number | undefined {
  if (typeof i.subtotalCents === "number") return i.subtotalCents;
  if (i.lineItems && i.lineItems.length) {
    return i.lineItems.reduce(
      (s, li) => s + Math.round((li.price ?? 0) * (li.quantity ?? 1)),
      0,
    );
  }
  return undefined;
}

export function invoiceExportRow(
  i: ExportInvoice,
  ctx: InvoiceRowContext,
): string[] {
  const party: Party = {
    ...(ctx.customer ?? {}),
    ...(i.customerSnapshot ?? {}),
    ...(i.billTo ?? {}),
  };
  const customerNumber = ctx.customer?.number ?? i.customerSnapshot?.number ??
    i.billTo?.number ?? "";
  const bal = invoiceBalance(i.amount, paidCentsOf(i));
  const voided = i.status === "void";
  return [
    docNumberOf(i),
    String(versionOf(i)),
    i.status ?? "draft",
    customerNumber,
    party.name ?? "",
    party.businessName ?? "",
    party.email ?? "",
    party.phoneNumber ?? "",
    party.address ?? "",
    i.serviceAddress ?? "",
    isoDate(i.serviceDateFrom),
    isoDate(i.serviceDateTo),
    ctx.quote ? docNumberOf(ctx.quote) : "",
    ctx.changeOrders.map((co) => docNumberOf(co)).join(" "),
    isoDate(i.issuedDate) || isoDate(i.createdAt),
    isoDate(i.dueDate),
    isoDate(i.paidAt),
    dollars(subtotalOf(i)),
    dollars(i.discountCents ?? 0),
    dollars(i.taxCents ?? 0),
    dollars(bal.amountCents),
    dollars(bal.paidCents),
    dollars(voided ? 0 : bal.balanceCents),
    dollars(bal.overpaidCents),
    ctx.link,
  ];
}

export interface InvoiceExportLookups<I extends ExportInvoice> {
  customerOf: (i: I) => ExportCustomer | undefined;
  quoteOf: (i: I) => ExportQuote | undefined;
  changeOrdersOf: (i: I) => ReadonlyArray<{ id: string; number?: string }>;
  linkOf: (i: I) => string;
}

export function invoiceExportCsv<I extends ExportInvoice>(
  invoices: readonly I[],
  lookups: InvoiceExportLookups<I>,
): string {
  return toCsv([
    [...INVOICE_EXPORT_HEADER],
    ...invoices.map((i) =>
      invoiceExportRow(i, {
        customer: lookups.customerOf(i),
        quote: lookups.quoteOf(i),
        changeOrders: lookups.changeOrdersOf(i),
        link: lookups.linkOf(i),
      })
    ),
  ]);
}

export const EXPORT_STATUSES = ["all", "paid", "unpaid"] as const;
export type ExportStatus = typeof EXPORT_STATUSES[number];

export function parseExportStatus(raw: unknown): ExportStatus | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return (EXPORT_STATUSES as readonly string[]).includes(s)
    ? (s as ExportStatus)
    : null;
}

/** Not in front of the customer yet, or cancelled: nothing is owed on these. */
const NOT_OPEN = new Set(["draft", "scheduled", "void", "paid"]);

/** An issued invoice that is not paid yet (sent, viewed, claimed…). */
export function isOpenInvoice(i: { status?: string }): boolean {
  return !NOT_OPEN.has(i.status ?? "draft");
}

export function filterInvoicesForExport<I extends { status?: string }>(
  invoices: readonly I[],
  status: ExportStatus,
): I[] {
  switch (status) {
    case "all":
      return [...invoices];
    case "paid":
      return invoices.filter((i) => i.status === "paid");
    case "unpaid":
      return invoices.filter(isOpenInvoice);
  }
}

// ---- customers ----

export const CUSTOMER_EXPORT_HEADER = [
  "Customer #",
  "Name",
  "Business",
  "Email",
  "Phone",
  "Address",
  "Created",
  "Quotes",
  "Invoices",
  "Open balance",
] as const;

export interface CustomerRowContext {
  quotes: ReadonlyArray<{ id: string; number?: string; seq?: number }>;
  invoices: ReadonlyArray<
    {
      id: string;
      number?: string;
      seq?: number;
      status?: string;
      amount?: number;
      paidCents?: number;
    }
  >;
}

const bySeq = (
  a: { seq?: number; number?: string },
  b: { seq?: number; number?: string },
) =>
  (a.seq ?? 0) - (b.seq ?? 0) || (a.number ?? "").localeCompare(b.number ?? "");

/** What the customer still owes: the balances of their open invoices, summed. */
export function openBalanceCents(
  invoices: CustomerRowContext["invoices"],
): number {
  return invoices
    .filter(isOpenInvoice)
    .reduce(
      (s, i) => s + invoiceBalance(i.amount, paidCentsOf(i)).balanceCents,
      0,
    );
}

export function customerExportRow(
  c: ExportCustomer,
  ctx: CustomerRowContext,
): string[] {
  return [
    docNumberOf(c),
    c.name ?? "",
    c.businessName ?? "",
    c.email ?? "",
    c.phoneNumber ?? "",
    c.address ?? "",
    isoDate(c.createdAt),
    [...ctx.quotes].sort(bySeq).map((q) => docNumberOf(q)).join(" "),
    [...ctx.invoices].sort(bySeq).map((i) => docNumberOf(i)).join(" "),
    dollars(openBalanceCents(ctx.invoices)),
  ];
}

export function customerExportCsv(
  customers: readonly ExportCustomer[],
  quotes: ReadonlyArray<
    { id: string; number?: string; seq?: number; customerId?: string }
  >,
  invoices: ReadonlyArray<
    {
      id: string;
      number?: string;
      seq?: number;
      customerId?: string;
      status?: string;
      amount?: number;
      paidCents?: number;
    }
  >,
): string {
  const quotesBy = new Map<string, typeof quotes[number][]>();
  for (const q of quotes) {
    if (q.customerId) {
      (quotesBy.get(q.customerId) ??
        quotesBy.set(q.customerId, []).get(q.customerId)!).push(q);
    }
  }
  const invoicesBy = new Map<string, typeof invoices[number][]>();
  for (const i of invoices) {
    if (i.customerId) {
      (invoicesBy.get(i.customerId) ??
        invoicesBy.set(i.customerId, []).get(i.customerId)!).push(i);
    }
  }
  return toCsv([
    [...CUSTOMER_EXPORT_HEADER],
    ...customers.map((c) =>
      customerExportRow(c, {
        quotes: quotesBy.get(c.id) ?? [],
        invoices: invoicesBy.get(c.id) ?? [],
      })
    ),
  ]);
}

// ---- REQ-795: date ranges, quotes, payments ----

/** A "YYYY-MM-DD" day that exists on the calendar; null for anything else. */
export function parseIsoDay(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    ? s
    : null;
}

/**
 * Is the stored date's ISO day inside [from, to]? Both ends inclusive and
 * each optional. A record with no date is in only when the range is open.
 */
export function inDateRange(
  value: string | null | undefined,
  from?: string | null,
  to?: string | null,
): boolean {
  const day = isoDate(value);
  if (!from && !to) return true;
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export type ExportSlice =
  | "invoices"
  | "unpaid"
  | "paid"
  | "payments"
  | "quotes"
  | "customers";

/** The day a slice is filtered on: issued (else created) for invoices, paid
 *  for paid invoices, received for payments, created for quotes and customers. */
export function exportDateOf(
  slice: ExportSlice,
  r: {
    issuedDate?: string;
    createdAt?: string;
    paidAt?: string;
    receivedAt?: string;
  },
): string {
  switch (slice) {
    case "paid":
      return isoDate(r.paidAt);
    case "payments":
      return isoDate(r.receivedAt);
    case "invoices":
    case "unpaid":
      return isoDate(r.issuedDate) || isoDate(r.createdAt);
    case "quotes":
    case "customers":
      return isoDate(r.createdAt);
  }
}

export function filterByDateRange<R>(
  rows: readonly R[],
  dateOf: (r: R) => string,
  from?: string | null,
  to?: string | null,
): R[] {
  if (!from && !to) return [...rows];
  return rows.filter((r) => inDateRange(dateOf(r), from, to));
}

export const QUOTE_EXPORT_HEADER = [
  "Quote #",
  "Status",
  "Customer #",
  "Customer",
  "Email",
  "Phone",
  "Job",
  "Total",
  "Created",
  "Sent",
  "Accepted",
  "Link",
] as const;

export interface ExportQuoteRow {
  id: string;
  number?: string;
  status?: string;
  customerId?: string;
  jobName?: string;
  summary?: string;
  estimatedTotal?: number;
  lineItems?: Array<{ price?: number; quantity?: number }>;
  createdAt?: string;
  sentAt?: string;
  acceptedAt?: string;
}

function quoteTotalOf(q: ExportQuoteRow): number {
  if (typeof q.estimatedTotal === "number") {
    return Math.max(0, Math.round(q.estimatedTotal));
  }
  return (q.lineItems ?? []).reduce(
    (s, li) => s + Math.round((li.price ?? 0) * (li.quantity ?? 1)),
    0,
  );
}

export function quoteExportCsv<Q extends ExportQuoteRow>(
  quotes: readonly Q[],
  lookups: {
    customerOf: (q: Q) => ExportCustomer | undefined;
    linkOf: (q: Q) => string;
  },
): string {
  return toCsv([
    [...QUOTE_EXPORT_HEADER],
    ...quotes.map((q) => {
      const c = lookups.customerOf(q);
      return [
        docNumberOf(q),
        q.status ?? "draft",
        c?.number ?? "",
        c?.name ?? "",
        c?.email ?? "",
        c?.phoneNumber ?? "",
        q.jobName ?? q.summary ?? "",
        dollars(quoteTotalOf(q)),
        isoDate(q.createdAt),
        isoDate(q.sentAt),
        isoDate(q.acceptedAt),
        lookups.linkOf(q),
      ];
    }),
  ]);
}

export const PAYMENT_EXPORT_HEADER = [
  "Received",
  "Invoice #",
  "Customer #",
  "Customer",
  "Method",
  "Amount",
  "Reference",
] as const;

export interface ExportPaymentRow {
  id: string;
  invoiceId: string;
  amount?: number;
  method?: string;
  receivedAt?: string;
  reference?: string;
}

export function paymentExportCsv<P extends ExportPaymentRow>(
  payments: readonly P[],
  lookups: {
    invoiceOf: (
      p: P,
    ) => { id: string; number?: string; customerId?: string } | undefined;
    customerOf: (customerId: string) => ExportCustomer | undefined;
  },
): string {
  return toCsv([
    [...PAYMENT_EXPORT_HEADER],
    ...payments.map((p) => {
      const inv = lookups.invoiceOf(p);
      const c = inv?.customerId
        ? lookups.customerOf(inv.customerId)
        : undefined;
      return [
        isoDate(p.receivedAt),
        inv ? docNumberOf(inv) : "",
        c?.number ?? "",
        c?.name ?? "",
        p.method ?? "",
        dollars(p.amount),
        p.reference ?? "",
      ];
    }),
  ]);
}

export type ExportRange = { from?: string; to?: string };

/** `?from`/`?to` as inclusive ISO days; `{field}` names the malformed one. */
export function parseExportRange(
  fromQ: unknown,
  toQ: unknown,
): ExportRange | { field: "from" | "to" } {
  const out: ExportRange = {};
  if (typeof fromQ === "string" && fromQ.trim() !== "") {
    const from = parseIsoDay(fromQ);
    if (!from) return { field: "from" };
    out.from = from;
  }
  if (typeof toQ === "string" && toQ.trim() !== "") {
    const to = parseIsoDay(toQ);
    if (!to) return { field: "to" };
    out.to = to;
  }
  return out;
}

/** "-2026-01-01-to-2026-01-31" for the download's file name; "" when open. */
export function exportRangeSuffix(range: ExportRange): string {
  if (!range.from && !range.to) return "";
  return `-${range.from ?? "start"}-to-${range.to ?? "today"}`;
}
