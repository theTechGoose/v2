/**
 * REQ-204 / REQ-201 — how every backend rendering (PDF, email, SMS, receipt)
 * names a document and shows its customer. Pure.
 *
 *   - a document is named by its number and version ("Invoice INV-5000",
 *     "Invoice INV-5000 · Version 2"), never by a slice of its id;
 *   - an ISSUED document shows the customer as they were when it was
 *     issued (`billTo`, else `customerSnapshot`) — a later CRM edit never
 *     rewrites a bill that is already out; a draft may show the live record.
 *
 * The strings here are the PDF / SMS vocabulary in both comms languages
 * (the PDFs and texts keep their own inline tables; lang/*.json is the
 * front end's).
 */
import { docNumberOf } from "#documents/numbering.ts";
import { fmtPhone } from "#identity/phone.ts";
import { invoiceBalance, versionOf } from "#documents/versions.ts";

export type RenderLang = "en" | "es";
export type RenderDocKind = "invoice" | "quote" | "changeOrder" | "workOrder";

/** The customer fields a rendered document shows. */
export interface RenderedCustomer {
  name?: string;
  businessName?: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
}

/** What `customerOnDocument` reads off a document. */
export interface CustomerBearingDoc {
  status?: string;
  sentAt?: string;
  publishedAt?: string;
  acceptedAt?: string;
  billTo?: RenderedCustomer;
  customerSnapshot?: RenderedCustomer;
}

/** A document is issued once it is (or was) in front of the customer.
 *  REQ-1100: a SCHEDULED invoice is never issued, even with `publishedAt` —
 *  a change-order approval revises it through `applyRevision`, which stamps
 *  publishedAt + a new version but sends nothing; the customer still never
 *  received it. Same for a draft that was revised but never sent. */
export function isIssued(doc: CustomerBearingDoc): boolean {
  if (doc.sentAt || doc.acceptedAt) return true;
  if (doc.status === "scheduled") return false;
  if (doc.status === "draft") return false;
  if (doc.publishedAt) return true;
  return doc.status !== undefined;
}

function pick(c: RenderedCustomer | undefined): RenderedCustomer | undefined {
  if (!c) return undefined;
  const s = (
    v: unknown,
  ) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const out: RenderedCustomer = {
    ...(s(c.name) ? { name: s(c.name) } : {}),
    ...(s(c.businessName) ? { businessName: s(c.businessName) } : {}),
    ...(s(c.email) ? { email: s(c.email) } : {}),
    ...(s(c.phoneNumber) ? { phoneNumber: s(c.phoneNumber) } : {}),
    ...(s(c.address) ? { address: s(c.address) } : {}),
  };
  return out.name || out.businessName ? out : undefined;
}

/**
 * REQ-204: the customer a rendering shows. `billTo` (typed on the invoice)
 * always wins; an issued document then shows its snapshot; the live record
 * is the fallback (and the draft's normal source).
 */
export function customerOnDocument(
  doc: CustomerBearingDoc,
  live: RenderedCustomer | undefined,
): RenderedCustomer | undefined {
  return pick(doc.billTo) ??
    (isIssued(doc) ? pick(doc.customerSnapshot) : undefined) ??
    pick(live) ??
    pick(doc.customerSnapshot);
}

/** The lines a Bill-to / Customer block draws: name, business, phone, email, address.
 *  The phone is stored as typed ("8435550277", "843-555-0142"), so it is drawn
 *  through the shared fmtPhone — "(843) 555-0277", like the web pages (REQ-965). */
export function customerLines(c: RenderedCustomer | undefined): string[] {
  if (!c) return [];
  const head = c.name && c.businessName && c.name !== c.businessName
    ? [c.name, c.businessName]
    : [c.name ?? c.businessName];
  return [...head, fmtPhone(c.phoneNumber), c.email, c.address]
    .filter((v): v is string => !!v && v.trim().length > 0);
}

const WORDS = {
  en: {
    invoice: "Invoice",
    quote: "Quote",
    changeOrder: "Change order",
    workOrder: "Work order",
    receipt: "Receipt",
    version: "Version",
    revisedInvoice: "Revised invoice — replaces previous version",
    revisedQuote: "Revised quote — replaces previous version",
    acceptedSigned: "Accepted and signed",
    paid: "PAID",
    paidPartial: "Paid {paid} · Balance {balance}",
    overpaid: "Overpaid by {amount} — we will refund or credit this",
    serviceAddress: "Service address",
    serviceDates: "Service dates",
    subtotal: "Subtotal",
    tax: "Tax",
    discount: "Discount",
    paymentInstructions: "Payment instructions",
    originalQuote: "Original quote",
    on: "on",
    from: "from",
    receiptFor: "Receipt for {number}",
    generated: "Generated {date}",
  },
  es: {
    invoice: "Factura",
    quote: "Cotización",
    changeOrder: "Orden de cambio",
    workOrder: "Orden de trabajo",
    receipt: "Recibo",
    version: "Versión",
    revisedInvoice: "Factura revisada — reemplaza la versión anterior",
    revisedQuote: "Cotización revisada — reemplaza la versión anterior",
    acceptedSigned: "Aceptada y firmada",
    paid: "PAGADA",
    paidPartial: "Pagado {paid} · Saldo {balance}",
    overpaid: "Pago en exceso de {amount} — lo reembolsaremos o acreditaremos",
    serviceAddress: "Dirección del servicio",
    serviceDates: "Fechas del servicio",
    subtotal: "Subtotal",
    tax: "Impuesto",
    discount: "Descuento",
    paymentInstructions: "Instrucciones de pago",
    originalQuote: "Cotización original",
    on: "en",
    from: "de",
    receiptFor: "Recibo de {number}",
    generated: "Generado {date}",
  },
} as const;

export type RenderWord = keyof typeof WORDS.en;

/** A rendering word in the comms language, with `{var}` placeholders filled. */
export function renderWord(
  lang: RenderLang,
  key: RenderWord,
  vars?: Record<string, string | number>,
): string {
  const s: string = WORDS[lang === "es" ? "es" : "en"][key];
  return vars
    ? s.replace(
      /\{(\w+)\}/g,
      (_, k) => (k in vars ? String(vars[k]) : `{${k}}`),
    )
    : s;
}

/** "INV-5000" (REQ-198) — or the legacy "#ABCDEF12" for rows written before numbering. */
export function docRef(doc: { number?: string; id: string }): string {
  return docNumberOf(doc);
}

/** "Version 2" when the document was revised, nothing on version 1 (REQ-201). */
export function versionLabel(
  doc: { version?: number },
  lang: RenderLang,
): string | undefined {
  const v = versionOf(doc);
  return v > 1 ? `${renderWord(lang, "version")} ${v}` : undefined;
}

/** "INV-5000 · Version 2" / "INV-5000". */
export function docRefWithVersion(
  doc: { number?: string; id: string; version?: number },
  lang: RenderLang,
): string {
  const v = versionLabel(doc, lang);
  return v ? `${docRef(doc)} · ${v}` : docRef(doc);
}

/** "Invoice INV-5000 · Version 2" — how a subject, a pill or a text names the document. */
export function docTitle(
  kind: RenderDocKind,
  doc: { number?: string; id: string; version?: number },
  lang: RenderLang,
): string {
  return `${renderWord(lang, kind)} ${docRefWithVersion(doc, lang)}`;
}

/** The "replaces previous version" line a revised document carries, else undefined. */
export function revisedNote(
  kind: "invoice" | "quote",
  doc: { version?: number },
  lang: RenderLang,
): string | undefined {
  if (versionOf(doc) <= 1) return undefined;
  return renderWord(
    lang,
    kind === "invoice" ? "revisedInvoice" : "revisedQuote",
  );
}

/**
 * "CO-001 on INV-5000" — how a change order names itself and its invoice
 * to the CUSTOMER. REQ-949: the invoice is named only once it is issued
 * (`isIssued`); a draft or scheduled balance invoice is one the customer
 * never received, so the order names its job instead ("CO-001 on Q-001"),
 * or just itself ("CO-001") when no job is known.
 */
export function changeOrderRef(
  co: { number?: string; id: string },
  invoice: ({ number?: string; id: string } & CustomerBearingDoc) | undefined,
  lang: RenderLang,
  job?: { number?: string; id: string },
): string {
  const on = invoice && isIssued(invoice) ? invoice : job;
  return on
    ? `${docRef(co)} ${renderWord(lang, "on")} ${docRef(on)}`
    : docRef(co);
}

/**
 * REQ-204 / REQ-949: the OWNER's name for a change order — always "CO-001
 * on INV-5000" when it hangs on an invoice, sent or not; the owner can see
 * their own drafts and scheduled invoices.
 */
export function changeOrderOwnerRef(
  co: { number?: string; id: string },
  invoice: { number?: string; id: string } | undefined,
  lang: RenderLang,
): string {
  return invoice
    ? `${docRef(co)} ${renderWord(lang, "on")} ${docRef(invoice)}`
    : docRef(co);
}

/** "8.25%" from basis points. */
export function fmtTaxRate(bp: number | undefined): string | undefined {
  if (typeof bp !== "number" || !Number.isFinite(bp)) return undefined;
  const pct = bp / 100;
  return `${
    Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2).replace(/0$/, "")
  }%`;
}

function usd(cents: number): string {
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/**
 * REQ-202: the payment state an invoice shows — "PAID", "Paid $X · Balance $Y"
 * on a partial payment, and the overpayment line when payments exceed the bill.
 */
export function paymentStateLines(
  invoice: {
    status?: string;
    amount?: number;
    paidCents?: number;
    overpaidCents?: number;
    paidAt?: string;
  },
  lang: RenderLang,
): { headline?: string; overpaid?: string } {
  const paidCents = invoice.paidCents ?? 0;
  const { balanceCents, overpaidCents } = invoiceBalance(
    invoice.amount,
    paidCents,
  );
  const over = Math.max(invoice.overpaidCents ?? 0, overpaidCents);
  const paid = invoice.status === "paid" || !!invoice.paidAt;
  const headline = paid
    ? renderWord(lang, "paid")
    : paidCents > 0
    ? renderWord(lang, "paidPartial", {
      paid: usd(paidCents),
      balance: usd(balanceCents),
    })
    : undefined;
  return {
    ...(headline ? { headline } : {}),
    ...(over > 0
      ? { overpaid: renderWord(lang, "overpaid", { amount: usd(over) }) }
      : {}),
  };
}
