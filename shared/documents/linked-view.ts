/**
 * REQ-201 / REQ-203 / REQ-205 / REQ-210 — the linked-documents view, pure.
 *
 * What a document says about itself ("Q-001 · Version 3 · Accepted and
 * signed · Nov 6, 2026"), the related-document rows a public page lists
 * under the document, the ledger summary the quote panel shows, and what a
 * public page does with a 409 from accept / claim-payment (a stale balance
 * shows the current balance; a stale version reloads). No DOM, no I/O, no
 * dictionary: the two languages' labels live here so the backend renderers
 * and the pages never drift.
 */
import type { DocState, DocVersionRecord, VersionChanges } from "./versions.ts";
import type { QuoteLedger } from "./ledger.ts";

export type Lang = "en" | "es";

const STATE_LABELS: Record<Lang, Record<DocState, string>> = {
  en: {
    draft: "Draft",
    sent: "Sent",
    revised: "Revised",
    accepted: "Accepted and signed",
    declined: "Declined",
    claimed: "Payment reported",
    paid: "Paid",
    void: "Void",
    approved: "Approved",
    pending: "Pending",
  },
  es: {
    draft: "Borrador",
    sent: "Enviada",
    revised: "Revisada",
    accepted: "Aceptada y firmada",
    declined: "Rechazada",
    claimed: "Pago reportado",
    paid: "Pagada",
    void: "Anulada",
    approved: "Aprobada",
    pending: "Pendiente",
  },
};

const WORDS: Record<
  Lang,
  {
    version: string;
    revisedInvoice: string;
    publishedBy: string;
    customer: string;
    by: string;
  }
> = {
  en: {
    version: "Version",
    revisedInvoice: "Revised invoice — replaces previous version",
    publishedBy: "published",
    customer: "the customer",
    by: "by",
  },
  es: {
    version: "Versión",
    revisedInvoice: "Factura revisada — reemplaza la versión anterior",
    publishedBy: "publicada",
    customer: "el cliente",
    by: "por",
  },
};

const SHORT_MONTHS: Record<Lang, readonly string[]> = {
  en: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],
  es: [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ],
};

/** "Nov 6, 2026" / "6 nov 2026"; a bare date-only string is read as noon UTC. */
export function shortDate(
  iso: string | undefined,
  lang: Lang = "en",
  withYear = true,
): string {
  if (!iso) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(+d)) return iso;
  const day = d.getUTCDate();
  const month = SHORT_MONTHS[lang === "es" ? "es" : "en"][d.getUTCMonth()];
  const year = d.getUTCFullYear();
  if (lang === "es") {
    return withYear ? `${day} ${month} ${year}` : `${day} ${month}`;
  }
  return withYear ? `${month} ${day}, ${year}` : `${month} ${day}`;
}

export function stateLabel(
  state: DocState | string | undefined,
  lang: Lang = "en",
): string {
  const table = STATE_LABELS[lang === "es" ? "es" : "en"];
  return (state && (table as Record<string, string>)[state]) || table.draft;
}

export interface HeadlineDoc {
  number: string;
  version?: number;
  state?: DocState | string;
  /** the date that goes with the state: signed at, published at, paid at */
  date?: string;
}

/** "Q-001 · Version 3 · Accepted and signed · Nov 6, 2026" */
export function docHeadline(doc: HeadlineDoc, lang: Lang = "en"): string {
  const w = WORDS[lang === "es" ? "es" : "en"];
  const parts = [doc.number, `${w.version} ${doc.version ?? 1}`];
  if (doc.state) parts.push(stateLabel(doc.state, lang));
  const date = shortDate(doc.date, lang);
  if (date) parts.push(date);
  return parts.join(" · ");
}

/** "INV-5000 · Version 2 · Revised invoice — replaces previous version" / "INV-5000 · Version 1 · Paid" */
export function invoiceHeadline(doc: HeadlineDoc, lang: Lang = "en"): string {
  const w = WORDS[lang === "es" ? "es" : "en"];
  const parts = [doc.number, `${w.version} ${doc.version ?? 1}`];
  if (doc.state === "revised") parts.push(w.revisedInvoice);
  else if (doc.state) parts.push(stateLabel(doc.state, lang));
  const date = shortDate(doc.date, lang);
  if (date) parts.push(date);
  return parts.join(" · ");
}

/** "Version 1 · published Nov 3 by Rafa" */
export function versionHistoryLine(
  v: Pick<DocVersionRecord, "version" | "publishedAt"> & {
    publishedBy?: DocVersionRecord["publishedBy"];
  },
  lang: Lang = "en",
): string {
  const w = WORDS[lang === "es" ? "es" : "en"];
  const who = v.publishedBy?.name?.trim() ||
    (v.publishedBy?.customer ? w.customer : "");
  const when = shortDate(v.publishedAt, lang, false);
  let line = `${w.version} ${v.version}`;
  if (when) line += ` · ${w.publishedBy} ${when}`;
  if (who) line += ` ${w.by} ${who}`;
  return line;
}

const CHANGE_WORDS: Record<
  Lang,
  {
    total: string;
    added: [string, string];
    removed: [string, string];
    changed: [string, string];
  }
> = {
  en: {
    total: "Total",
    added: ["line added", "lines added"],
    removed: ["line removed", "lines removed"],
    changed: ["line changed", "lines changed"],
  },
  es: {
    total: "Total",
    added: ["línea agregada", "líneas agregadas"],
    removed: ["línea eliminada", "líneas eliminadas"],
    changed: ["línea cambiada", "líneas cambiadas"],
  },
};

function usd(cents: number): string {
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/** REQ-248: "Total $14,700.00 → $15,200.00 · 1 line added · 1 line changed"; "" when nothing changed. */
export function versionChangeLine(
  c: VersionChanges,
  lang: Lang = "en",
): string {
  const w = CHANGE_WORDS[lang === "es" ? "es" : "en"];
  const parts: string[] = [];
  if (
    typeof c.totalFromCents === "number" && typeof c.totalToCents === "number"
  ) {
    parts.push(`${w.total} ${usd(c.totalFromCents)} → ${usd(c.totalToCents)}`);
  }
  const count = (n: number, [one, many]: [string, string]) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  count(c.linesAdded, w.added);
  count(c.linesRemoved, w.removed);
  count(c.linesChanged, w.changed);
  return parts.join(" · ");
}

// ---------- related documents on a public page ----------

export interface LinkedInvoiceLike {
  id: string;
  number: string;
  url?: string;
  status?: string;
  state?: string;
  version?: number;
  amountCents?: number;
  paidCents?: number;
  balanceCents?: number;
  dueDate?: string;
  paidAt?: string;
}

export interface LinkedChangeOrderLike {
  id: string;
  number: string;
  url?: string;
  status?: string;
  deltaAmountCents: number;
  description?: string;
}

export interface RelatedDocumentRow {
  kind: "invoice" | "changeOrder";
  id: string;
  number: string;
  url: string;
  stateLabel: string;
  amountCents?: number;
  paidCents?: number;
  balanceCents?: number;
  deltaAmountCents?: number;
  dueDate?: string;
  description?: string;
}

/** The rows under a public document: every invoice, the approved change orders. */
export function relatedDocumentRows(
  payload: {
    invoices?: LinkedInvoiceLike[];
    changeOrders?: LinkedChangeOrderLike[];
  },
  lang: Lang = "en",
): RelatedDocumentRow[] {
  const rows: RelatedDocumentRow[] = [];
  for (const i of payload.invoices ?? []) {
    rows.push({
      kind: "invoice",
      id: i.id,
      number: i.number,
      url: i.url ?? `/i/${i.id}`,
      stateLabel: stateLabel(i.state ?? invoiceStateOf(i.status), lang),
      amountCents: i.amountCents ?? 0,
      paidCents: i.paidCents ?? 0,
      balanceCents: i.balanceCents ??
        Math.max(0, (i.amountCents ?? 0) - (i.paidCents ?? 0)),
      ...(i.dueDate ? { dueDate: i.dueDate } : {}),
    });
  }
  for (const co of payload.changeOrders ?? []) {
    if (co.status !== "approved") continue;
    rows.push({
      kind: "changeOrder",
      id: co.id,
      number: co.number,
      url: co.url ?? `/co/${co.id}`,
      stateLabel: stateLabel("approved", lang),
      deltaAmountCents: co.deltaAmountCents,
      ...(co.description ? { description: co.description } : {}),
    });
  }
  return rows;
}

// ---------- the signed quote's pay hand-off (REQ-251) ----------

export interface PayNowTarget {
  invoiceId: string;
  number: string;
  url: string;
  balanceCents: number;
}

/** Invoice statuses the customer can still pay from its public page. */
const PAYABLE_STATUSES = new Set(["sent", "viewed"]);

/**
 * REQ-251 (demo quote-invoice-money-m13): the invoice a signed quote's
 * "Pay now" button opens — the first open invoice billed against the
 * agreement (the public payload lists them in number / installment order)
 * with a balance still owed. None while the quote is unsigned, or when every
 * invoice is paid, reported paid, void, or not yet issued.
 */
export function payNowTarget(
  quote: {
    status?: string;
    state?: string;
    invoices?: LinkedInvoiceLike[];
  },
): PayNowTarget | undefined {
  if (quote.status !== "accepted" && quote.state !== "accepted") {
    return undefined;
  }
  for (const i of quote.invoices ?? []) {
    if (!PAYABLE_STATUSES.has(i.status ?? "")) continue;
    const balanceCents = i.balanceCents ??
      Math.max(0, (i.amountCents ?? 0) - (i.paidCents ?? 0));
    if (balanceCents <= 0) continue;
    return {
      invoiceId: i.id,
      number: i.number,
      url: i.url ?? `/i/${i.id}`,
      balanceCents,
    };
  }
  return undefined;
}

function invoiceStateOf(status: string | undefined): DocState {
  if (status === "paid" || status === "void" || status === "claimed") {
    return status;
  }
  if (!status || status === "draft" || status === "scheduled") return "draft";
  return "sent";
}

// ---------- the quote panel's ledger ----------

export type LedgerRowKey =
  | "quoted"
  | "agreed"
  | "invoiced"
  | "paid"
  | "invoicedUnpaid"
  | "remaining";

export interface LedgerSummary {
  rows: { key: LedgerRowKey; cents: number }[];
  overpaid: boolean;
  overpaidCents: number;
  canCreateNextInvoice: boolean;
}

/** The panel's totals. The first row is the agreement total; it is
 *  "agreed" only once the customer has signed — until then nothing was
 *  agreed, so it reads "quoted" (REQ-249). */
export function ledgerSummary(
  l: Pick<
    QuoteLedger,
    | "quote"
    | "agreementTotalCents"
    | "invoicedCents"
    | "paidCents"
    | "invoicedUnpaidCents"
    | "remainingToInvoiceCents"
    | "overpaidCents"
  >,
): LedgerSummary {
  return {
    rows: [
      {
        key: l.quote.accepted ? "agreed" : "quoted",
        cents: l.agreementTotalCents,
      },
      { key: "invoiced", cents: l.invoicedCents },
      { key: "paid", cents: l.paidCents },
      { key: "invoicedUnpaid", cents: l.invoicedUnpaidCents },
      { key: "remaining", cents: l.remainingToInvoiceCents },
    ],
    overpaid: l.overpaidCents > 0,
    overpaidCents: l.overpaidCents,
    canCreateNextInvoice: l.remainingToInvoiceCents > 0,
  };
}

// ---------- 409 decisions on the public pages (REQ-203) ----------

export type ClaimDecision =
  | { kind: "ok" }
  | { kind: "stale_balance"; balanceCents: number; version?: number }
  | { kind: "already_paid" }
  | { kind: "error"; reason: string };

function reasonOf(body: unknown, status: number): string {
  const r = body && typeof body === "object"
    ? (body as { reason?: unknown }).reason
    : undefined;
  return typeof r === "string" && r ? r : String(status);
}

/** What the invoice page does with the claim-payment response. */
export function claimDecision(status: number, body: unknown): ClaimDecision {
  if (status >= 200 && status < 300) return { kind: "ok" };
  const reason = reasonOf(body, status);
  if (status === 409 && reason === "stale_balance") {
    const b = body as { balanceCents?: unknown; version?: unknown };
    return {
      kind: "stale_balance",
      balanceCents: typeof b.balanceCents === "number" ? b.balanceCents : 0,
      ...(typeof b.version === "number" ? { version: b.version } : {}),
    };
  }
  if (status === 409 && reason === "already_paid") {
    return { kind: "already_paid" };
  }
  return { kind: "error", reason };
}

export type AcceptDecision =
  | { kind: "ok" }
  | { kind: "stale_version"; currentVersion?: number }
  | { kind: "already_accepted" }
  /** REQ-306: the business's own session tried to sign its customer's quote. */
  | { kind: "owner_cannot_sign" }
  | { kind: "error"; reason: string };

/** What the quote page does with the accept response. */
export function acceptDecision(status: number, body: unknown): AcceptDecision {
  if (status >= 200 && status < 300) return { kind: "ok" };
  const reason = reasonOf(body, status);
  if (status === 409 && reason === "stale_version") {
    const v = (body as { currentVersion?: unknown }).currentVersion;
    return {
      kind: "stale_version",
      ...(typeof v === "number" ? { currentVersion: v } : {}),
    };
  }
  if (status === 409 && reason === "already_accepted") {
    return { kind: "already_accepted" };
  }
  if (status === 409 && reason === "owner_cannot_sign") {
    return { kind: "owner_cannot_sign" };
  }
  return { kind: "error", reason };
}

/** The claim body: the method, the trimmed optionals, the balance and version the page shows. */
export function claimBody(
  form: { method: string; reference?: string; claimedBy?: string },
  shown: { balanceCents: number; version?: number },
): Record<string, unknown> {
  const reference = form.reference?.trim();
  const claimedBy = form.claimedBy?.trim();
  return {
    method: form.method,
    ...(reference ? { reference } : {}),
    ...(claimedBy ? { claimedBy } : {}),
    amountCents: shown.balanceCents,
    ...(typeof shown.version === "number" ? { version: shown.version } : {}),
  };
}

// ---------- work orders (REQ-210) ----------

export type WorkOrderStatus = "open" | "in_progress" | "done" | "cancelled";

/** open → in progress → done; cancel from any open state; a cancelled one reopens. */
export function workOrderNextStatuses(
  status: WorkOrderStatus | string,
): WorkOrderStatus[] {
  switch (status) {
    case "open":
      return ["in_progress", "cancelled"];
    case "in_progress":
      return ["done", "cancelled"];
    case "cancelled":
      return ["open"];
    default:
      return [];
  }
}
