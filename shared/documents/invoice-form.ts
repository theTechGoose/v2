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
import { MAX_CENTS } from "../quote-flow/assistant-draft.ts";
import {
  formatPhoneDisplay,
  formatPhoneInput,
  isUsPhone,
} from "../quote-flow/format-helpers.ts";
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

/** REQ-483 (demo-loop cycle 3, m18): the picker's preset day counts. Any
 *  other count opens as custom terms with its due date filled in. */
export function isPresetNetDays(n: number): boolean {
  return (NET_DAYS_OPTIONS as readonly number[]).includes(n);
}

/** REQ-483 (m18): the days a New invoice starts with. Drawn from a quote,
 *  its payment terms decide — "Due now" → 0, "Net N" → N, "upon completion"
 *  → the account's days (REQ-411: the bill goes out when the job is done and
 *  the customer then has those days). Otherwise — no quote, a split, custom
 *  text — Settings' "Days to pay an invoice" (`invoiceNetDays`), else 30.
 *  Terms are stored as the EN option label (handle-wizard-answer). */
export function defaultInvoiceNetDays(
  invoiceNetDays: number | null | undefined,
  quoteTerms:
    | ReadonlyArray<{ stepId?: string; value?: string }>
    | null
    | undefined,
): number {
  const account = typeof invoiceNetDays === "number" &&
      Number.isInteger(invoiceNetDays) && invoiceNetDays >= 0
    ? invoiceNetDays
    : 30;
  const value = quoteTerms?.find((t) => t?.stepId === "payment_terms")?.value;
  if (!value) return account;
  if (/\bdue now\b/i.test(value)) return 0;
  const net = /\bnet\s*-?\s*(\d{1,3})\b/i.exec(value);
  if (net) return Number(net[1]);
  return account;
}

/* ---------------- payment instructions (REQ-483, M40) ---------------- */

type PayMethod = {
  enabled?: boolean;
  handle?: string;
  cashtag?: string;
  mailTo?: string;
  instructions?: string;
};
export type AcceptedMethods = Partial<Record<string, PayMethod | undefined>>;

const METHOD_LABELS: Record<"en" | "es", Record<string, string>> = {
  en: {
    check: "Check",
    venmo: "Venmo",
    zelle: "Zelle",
    cashapp: "Cash App",
    paypal: "PayPal",
    cash: "Cash",
    ach: "Bank transfer",
    card: "Card",
  },
  es: {
    check: "Cheque",
    venmo: "Venmo",
    zelle: "Zelle",
    cashapp: "Cash App",
    paypal: "PayPal",
    cash: "Efectivo",
    ach: "Transferencia bancaria",
    card: "Tarjeta",
  },
};

/** The order the public invoice page lists them (projectAcceptedMethods). */
const METHOD_ORDER = [
  "check",
  "venmo",
  "zelle",
  "cashapp",
  "paypal",
  "cash",
  "ach",
  "card",
  "other",
] as const;

/** The methods saved at onboarding / in Settings as one line of payment
 *  instructions: "Zelle: 5125550102 · Cash". Enabled methods only, each with
 *  the handle the customer needs (never ACH's routing/account numbers —
 *  only its own instructions); "other" is its free text alone. */
export function paymentInstructionsFromMethods(
  methods: AcceptedMethods | null | undefined,
  lang: string,
): string {
  if (!methods) return "";
  const labels = METHOD_LABELS[lang === "es" ? "es" : "en"];
  const parts: string[] = [];
  for (const key of METHOD_ORDER) {
    const m = methods[key];
    if (!m?.enabled) continue;
    const detail = (key === "check"
      ? m.mailTo
      : key === "cashapp"
      ? m.cashtag
      : key === "ach" || key === "card" || key === "other"
      ? m.instructions
      : m.handle)?.trim();
    // REQ-593 (cycle 4, m12): a phone handle reads like a phone —
    // "Zelle: +1 (512) 555-0109", not the digits as typed at onboarding.
    const shown = detail && isUsPhone(detail)
      ? formatPhoneDisplay(detail)
      : detail;
    if (key === "other") {
      if (detail) {
        parts.push(detail);
      }
      continue;
    }
    parts.push(shown ? `${labels[key]}: ${shown}` : labels[key]);
  }
  return parts.join(" · ");
}

/** REQ-483 (M40): what "Payment instructions" starts with — Settings' own
 *  text first, else what was last typed on this device, else the accepted
 *  methods (so onboarding's Zelle is never a blank field). */
export function defaultPaymentInstructions(input: {
  settings?: string | null;
  remembered?: string | null;
  methods?: AcceptedMethods | null;
  lang: string;
}): string {
  if (typeof input.settings === "string" && input.settings.trim()) {
    return input.settings;
  }
  if (typeof input.remembered === "string" && input.remembered.trim()) {
    return input.remembered;
  }
  return paymentInstructionsFromMethods(input.methods, input.lang);
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
    // REQ-593 (cycle 4, m12): the stored digits fill the field in the same
    // mask the input applies as you type; anything else is kept as is.
    phoneNumber: isUsPhone(c?.phoneNumber)
      ? formatPhoneInput(c!.phoneNumber!)
      : c?.phoneNumber ?? "",
    address: c?.address ?? "",
  };
}

/* ---------------- missing info ---------------- */

export type MissingInfo =
  | "noBillingName"
  | "noContact"
  | "noServiceAddress"
  | "noLineItems"
  | "noAmount";

/** How an issued bill reaches the client (REQ-567): by email, by text, both,
 *  or not at all (copy the link). */
export type SendChannel = "email" | "text" | "both" | "none";

export function sendChannel(
  c: { email?: string; phoneNumber?: string },
): SendChannel {
  const email = !!c.email?.trim();
  const phone = !!c.phoneNumber?.trim();
  if (email && phone) return "both";
  if (email) return "email";
  if (phone) return "text";
  return "none";
}

/** What the bill still lacks — a prompt before sending, never a block. */
export function missingInfo(form: {
  billTo: Pick<BillTo, "name" | "email" | "address"> & {
    phoneNumber?: string;
  };
  serviceAddress: string;
  lineItems: FormLine[];
  amountCents: number;
}): MissingInfo[] {
  const out: MissingInfo[] = [];
  if (!form.billTo.name.trim()) out.push("noBillingName");
  // REQ-567 (cycle 4, m37): a phone is a way to send it (by text) — only a
  // client with neither email nor phone is unreachable.
  if (sendChannel(form.billTo) === "none") out.push("noContact");
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

/**
 * REQ-480 (demo-loop cycle 3, M18): the status a New invoice is created with.
 * "Issue" with a dispatch to follow creates it UNISSUED (draft): the send
 * endpoints stamp it "sent" only once a channel actually delivers, so an
 * invoice nobody received is never listed as Sent. REQ-550 (demo-loop cycle
 * 4, B1) amends the no-contact case: with nothing to dispatch, nothing was
 * sent either — it is a draft too, and the page says "not sent — share the
 * link" (`invoiceNotSentCopy`). Saving keeps the draft / scheduled tracks.
 */
export function newInvoiceStatus(
  opts: { issue: boolean; dispatch: boolean; scheduledFor?: string },
): "draft" | "sent" | "scheduled" {
  if (opts.issue) return "draft";
  return opts.scheduledFor ? "scheduled" : "draft";
}

/** REQ-550: the most an invoice may bill, INTEGER CENTS — the $1bn cap the
 *  assistant draft already uses (and POST /invoices enforces). */
export const INVOICE_MAX_CENTS = MAX_CENTS;
/** REQ-550: above this total ($250,000) "Issue" asks for a second press. */
export const INVOICE_CONFIRM_CENTS = 250_000_00;

/**
 * REQ-550 (demo-loop cycle 4, B1): why the New invoice form must not go
 * ahead, as an `invoicesPage.new.*` key — or null. A total past the cap is
 * refused on any path; "Issue" also needs someone to bill: an existing
 * client, a new client's name, or a typed bill-to name. A draft needs no
 * recipient. (The missing-info list stays a prompt — REQ-206.)
 */
export function invoiceIssueBlock(opts: {
  issue: boolean;
  totalCents: number;
  customerId?: string;
  newClientName?: string;
  billToName?: string;
}): "errRecipient" | "errAmountMax" | null {
  if (opts.totalCents > INVOICE_MAX_CENTS) return "errAmountMax";
  if (
    opts.issue && !nonEmpty(opts.customerId) &&
    !nonEmpty(opts.newClientName) && !nonEmpty(opts.billToName)
  ) {
    return "errRecipient";
  }
  return null;
}

/** REQ-550: an invoice total over INVOICE_CONFIRM_CENTS needs the contractor
 *  to confirm that exact total (`confirmedCents`) before it is issued. */
export function needsAmountConfirm(
  totalCents: number,
  confirmedCents?: number | null,
): boolean {
  return totalCents > INVOICE_CONFIRM_CENTS && confirmedCents !== totalCents;
}

/** REQ-550: the notice after "Issue" when there was nobody to send it to —
 *  "INV-003 saved — not sent: …; share its link: <link>". */
export function invoiceNotSentCopy(
  t: (key: string, params?: Record<string, string>) => string,
  opts: { number?: string; link: string },
): string {
  return t("invoicesPage.send.notSentShareLink", {
    number: nonEmpty(opts.number) ?? t("invoicesPage.send.invoiceFallback"),
    link: opts.link,
  });
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

/* ---------- what the picked client already has (REQ-474) ---------- */

/** One of the client's invoices still in flight: scheduled, drafted, or out
 *  for payment (sent / viewed / claimed / pending) and unpaid. */
export interface PriorInvoice {
  id: string;
  number: string;
  kind: "scheduled" | "draft" | "open";
  /** what is still owed on it (amount − paid), cents */
  amountCents: number;
  quoteId?: string;
  quoteNumber?: string;
}

/** A signed quote of the client's — the invoice can be linked to it, which
 *  sends the quoteId and puts the REQ-233 agreement cap on it. */
export interface LinkableQuote {
  id: string;
  number: string;
  /** the agreement less every live invoice on it, ≥ 0 */
  remainingCents: number;
}

export interface PriorBilling {
  invoices: PriorInvoice[];
  quotes: LinkableQuote[];
}

interface PriorInvoiceIn {
  id: string;
  number?: string;
  customerId?: string;
  quoteId?: string;
  status?: string;
  amount?: number;
  paidCents?: number | null;
  paidAt?: string | null;
}

interface PriorQuoteIn {
  id: string;
  number?: string;
  customerId?: string;
  status?: string;
  acceptedAt?: string | null;
  estimatedTotal?: number;
  isSample?: boolean;
}

const OPEN_STATUSES = new Set(["sent", "viewed", "claimed", "pending"]);
const CLOSED_QUOTE = new Set(["lost", "void", "canceled", "cancelled"]);

/**
 * REQ-474 (demo-loop cycle 3, M17): the New invoice modal's "this client
 * already has…" — before a direct bill is made beside a scheduled one. The
 * client's unpaid scheduled / draft / open invoices (on their customerId, or
 * on one of their quotes), and their signed quotes with what is left to bill.
 * Nothing for no client or a client being created in the form.
 */
export function priorBillingFor(
  customerId: string | null | undefined,
  invoices: readonly PriorInvoiceIn[],
  quotes: readonly PriorQuoteIn[],
): PriorBilling {
  if (!customerId || customerId === "__new__") {
    return { invoices: [], quotes: [] };
  }
  const theirQuotes = quotes.filter((q) =>
    q.customerId === customerId && !q.isSample
  );
  const quoteIds = new Set(theirQuotes.map((q) => q.id));
  const numberOf = new Map(theirQuotes.map((q) => [q.id, docNumberOf(q)]));
  const live = invoices.filter((i) =>
    (i.status ?? "") !== "void" &&
    (i.customerId === customerId || (!!i.quoteId && quoteIds.has(i.quoteId)))
  );

  const prior: PriorInvoice[] = [];
  for (const i of live) {
    const status = i.status ?? "";
    const kind = status === "scheduled"
      ? "scheduled"
      : status === "draft"
      ? "draft"
      : OPEN_STATUSES.has(status)
      ? "open"
      : null;
    const owed = Math.max(0, (i.amount ?? 0) - (i.paidCents ?? 0));
    if (!kind || i.paidAt || owed <= 0) continue;
    const quoteNumber = i.quoteId ? numberOf.get(i.quoteId) : undefined;
    prior.push({
      id: i.id,
      number: docNumberOf(i),
      kind,
      amountCents: owed,
      ...(i.quoteId ? { quoteId: i.quoteId } : {}),
      ...(quoteNumber ? { quoteNumber } : {}),
    });
  }

  // a signed quote is offered while it has money left to bill or a bill of
  // it is still in flight — a long-paid job is not news
  const signed: LinkableQuote[] = theirQuotes
    .filter((q) =>
      (q.status === "accepted" || !!q.acceptedAt) &&
      !CLOSED_QUOTE.has(q.status ?? "")
    )
    .map((q) => {
      const invoiced = live.filter((i) => i.quoteId === q.id)
        .reduce((s, i) => s + (i.amount ?? 0), 0);
      return {
        id: q.id,
        number: docNumberOf(q),
        remainingCents: Math.max(0, (q.estimatedTotal ?? 0) - invoiced),
      };
    })
    .filter((q) =>
      q.remainingCents > 0 || prior.some((i) => i.quoteId === q.id)
    );
  return { invoices: prior, quotes: signed };
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
      state !== "draft" && state !== "scheduled",
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
