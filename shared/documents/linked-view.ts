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
import type {
  DocState,
  DocVersionRecord,
  LineSummary,
  VersionChanges,
} from "./versions.ts";
import { type QuoteLedger, quoteTotalCents } from "./ledger.ts";

export type Lang = "en" | "es";

const STATE_LABELS: Record<Lang, Record<DocState, string>> = {
  en: {
    draft: "Draft",
    scheduled: "Scheduled",
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
    scheduled: "Programada",
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
    awaitingApproval: string;
    invoice: string;
    due: string;
  }
> = {
  en: {
    version: "Version",
    revisedInvoice: "Revised invoice — replaces previous version",
    publishedBy: "published",
    customer: "the customer",
    by: "by",
    awaitingApproval: "Waiting for your approval",
    invoice: "Invoice",
    due: "due",
  },
  es: {
    version: "Versión",
    revisedInvoice: "Factura revisada — reemplaza la versión anterior",
    publishedBy: "publicada",
    customer: "el cliente",
    by: "por",
    awaitingApproval: "Esperando tu aprobación",
    invoice: "Factura",
    due: "vence",
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

/** REQ-558: states only the business sees — never named to a customer. */
const OWNER_ONLY_INVOICE_STATES: ReadonlySet<string> = new Set([
  "draft",
  "scheduled",
]);

export interface InvoiceHeadlineDoc extends HeadlineDoc {
  /** REQ-558: the viewer is the business itself (the public payload's
   *  `internal`); only then are owner-only states named. */
  internal?: boolean;
  /** REQ-558: what a customer reads instead of an owner-only state. */
  dueDate?: string;
}

/** "INV-5000 · Version 2 · Revised invoice — replaces previous version" / "INV-5000 · Version 1 · Paid";
 *  REQ-558: a customer never reads "Scheduled"/"Draft" — "INV-5001 · Version 1 · Invoice · due Dec 1, 2026". */
export function invoiceHeadline(
  doc: InvoiceHeadlineDoc,
  lang: Lang = "en",
): string {
  const w = WORDS[lang === "es" ? "es" : "en"];
  const parts = [doc.number, `${w.version} ${doc.version ?? 1}`];
  if (
    !doc.internal && doc.state && OWNER_ONLY_INVOICE_STATES.has(doc.state)
  ) {
    parts.push(w.invoice);
    const due = shortDate(doc.dueDate, lang);
    if (due) parts.push(`${w.due} ${due}`);
    return parts.join(" · ");
  }
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
    /** REQ-395: the named-line labels — "Added: Tile backsplash ($700.00)" */
    addedNamed: string;
    removedNamed: string;
    changedNamed: string;
    untitled: string;
  }
> = {
  en: {
    total: "Total",
    added: ["line added", "lines added"],
    removed: ["line removed", "lines removed"],
    changed: ["line changed", "lines changed"],
    addedNamed: "Added",
    removedNamed: "Removed",
    changedNamed: "Changed",
    untitled: "Untitled line",
  },
  es: {
    total: "Total",
    added: ["línea agregada", "líneas agregadas"],
    removed: ["línea eliminada", "líneas eliminadas"],
    changed: ["línea cambiada", "líneas cambiadas"],
    addedNamed: "Agregado",
    removedNamed: "Eliminado",
    changedNamed: "Cambiado",
    untitled: "Línea sin título",
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

/** REQ-248 / REQ-395: "Total $18,500.00 → $19,200.00 · Added: Tile backsplash ($700.00)";
 *  counts ("2 lines removed") only when the change carries no line names; "" when nothing changed. */
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
  const name = (l: LineSummary) => clip(l.description) || w.untitled;
  const named = (label: string, lines: LineSummary[]) =>
    parts.push(
      `${label}: ${
        lines.map((l) => `${name(l)} (${usd(l.totalCents)})`).join(", ")
      }`,
    );
  if (c.added?.length) named(w.addedNamed, c.added);
  else count(c.linesAdded, w.added);
  if (c.removed?.length) named(w.removedNamed, c.removed);
  else count(c.linesRemoved, w.removed);
  if (c.changed?.length) {
    parts.push(
      `${w.changedNamed}: ${
        c.changed.map(({ from, to }) => {
          const label = name(from) === name(to)
            ? name(to)
            : `${name(from)} → ${name(to)}`;
          const amount = from.totalCents === to.totalCents
            ? usd(to.totalCents)
            : `${usd(from.totalCents)} → ${usd(to.totalCents)}`;
          return `${label} (${amount})`;
        }).join(", ")
      }`,
    );
  } else count(c.linesChanged, w.changed);
  return parts.join(" · ");
}

/** A line's description, kept to one short phrase in a summary. */
function clip(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 60 ? `${one.slice(0, 57).trimEnd()}…` : one;
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
  /** REQ-457: a change order still waiting for the customer's approval */
  pending?: boolean;
}

/**
 * The rows under a public document: every invoice, the approved change
 * orders, and (REQ-457, demo M27) the change orders still waiting for the
 * customer — "Waiting for your approval", linking /co/:id. Declined ones
 * are left off.
 */
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
    const pending = isPendingChangeOrder(co);
    if (co.status !== "approved" && !pending) continue;
    rows.push({
      kind: "changeOrder",
      id: co.id,
      number: co.number,
      url: co.url ?? `/co/${co.id}`,
      stateLabel: pending
        ? WORDS[lang === "es" ? "es" : "en"].awaitingApproval
        : stateLabel("approved", lang),
      deltaAmountCents: co.deltaAmountCents,
      ...(co.description ? { description: co.description } : {}),
      ...(pending ? { pending: true } : {}),
    });
  }
  return rows;
}

/** A change order with no decision yet (the store's default status). */
function isPendingChangeOrder(co: LinkedChangeOrderLike): boolean {
  return (co.status ?? "pending") === "pending";
}

// ---------- the signed quote's pending change orders (REQ-457) ----------

export interface PendingChangeOrderNotice {
  id: string;
  number: string;
  url: string;
  deltaAmountCents: number;
  /** the job total once this change is approved: quote + approved + this */
  newTotalCents: number;
}

/**
 * REQ-457 (demo M27, cycle 3): what the signed /q says about each change
 * order still waiting for the customer — "A change order (CO-001, +$1,200)
 * is waiting for your approval — new job total $8,250". The job total is
 * the quote's total plus the approved change orders (the ledger's agreement
 * total, REQ-205), plus this change.
 */
export function pendingChangeOrderNotices(
  quote: {
    estimatedTotal?: number;
    lineItems?: { price?: number; quantity?: number }[];
    changeOrders?: LinkedChangeOrderLike[];
  },
): PendingChangeOrderNotice[] {
  const cos = quote.changeOrders ?? [];
  const pending = cos.filter(isPendingChangeOrder);
  if (pending.length === 0) return [];
  const base = quoteTotalCents(quote);
  const approved = cos
    .filter((co) => co.status === "approved")
    .reduce((s, co) => s + Math.round(co.deltaAmountCents), 0);
  const agreement = Math.max(0, base + approved);
  return pending.map((co) => ({
    id: co.id,
    number: co.number,
    url: co.url ?? `/co/${co.id}`,
    deltaAmountCents: co.deltaAmountCents,
    newTotalCents: Math.max(0, agreement + Math.round(co.deltaAmountCents)),
  }));
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
  if (status === "scheduled") return "scheduled";
  if (!status || status === "draft") return "draft";
  return "sent";
}

// ---------- the quote panel's ledger ----------

export type LedgerRowKey =
  | "quoted"
  | "agreed"
  | "invoiced"
  | "paid"
  | "invoicedUnpaid"
  | "scheduled"
  | "remaining";

export interface LedgerSummary {
  rows: { key: LedgerRowKey; cents: number }[];
  overpaid: boolean;
  overpaidCents: number;
  canCreateNextInvoice: boolean;
  /** REQ-481: the first not-yet-sent invoice (the "Scheduled" row's subject) */
  scheduled?: { number: string; scheduledFor?: string };
  /** REQ-481: why "Create next invoice" is off — the rest may sit on a
   *  scheduled invoice rather than on bills the customer already has */
  fullyInvoicedKey:
    | "quotes.ledger.fullyInvoiced"
    | "quotes.ledger.restScheduled"
    | "quotes.ledger.restDrafted";
}

/** The panel's totals. The first row is the agreement total; it is
 *  "agreed" only once the customer has signed — until then nothing was
 *  agreed, so it reads "quoted" (REQ-249). */
export function ledgerSummary(
  l:
    & Pick<
      QuoteLedger,
      | "quote"
      | "agreementTotalCents"
      | "invoicedCents"
      | "paidCents"
      | "invoicedUnpaidCents"
      | "remainingToInvoiceCents"
      | "overpaidCents"
    >
    & Partial<
      Pick<QuoteLedger, "billedCents" | "scheduledCents" | "nextScheduled">
    >,
): LedgerSummary {
  // REQ-481 (demo M28): "Invoiced" is what the customer was billed; a
  // scheduled installment or a draft gets its own "Scheduled" row.
  const scheduledCents = l.scheduledCents ?? 0;
  const next = l.nextScheduled;
  return {
    rows: [
      {
        key: l.quote.accepted ? "agreed" : "quoted",
        cents: l.agreementTotalCents,
      },
      { key: "invoiced", cents: l.billedCents ?? l.invoicedCents },
      { key: "paid", cents: l.paidCents },
      { key: "invoicedUnpaid", cents: l.invoicedUnpaidCents },
      ...(scheduledCents > 0
        ? [{ key: "scheduled" as const, cents: scheduledCents }]
        : []),
      { key: "remaining", cents: l.remainingToInvoiceCents },
    ],
    overpaid: l.overpaidCents > 0,
    overpaidCents: l.overpaidCents,
    canCreateNextInvoice: l.remainingToInvoiceCents > 0,
    ...(next
      ? {
        scheduled: {
          number: next.number,
          ...(next.scheduledFor ? { scheduledFor: next.scheduledFor } : {}),
        },
      }
      : {}),
    fullyInvoicedKey: !next
      ? "quotes.ledger.fullyInvoiced"
      : next.scheduledFor
      ? "quotes.ledger.restScheduled"
      : "quotes.ledger.restDrafted",
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
  /** REQ-460: not signable yet — never sent, or no payment terms on it. */
  | { kind: "not_ready" }
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
  if (
    status === 409 &&
    (reason === "not_issued" || reason === "terms_incomplete")
  ) {
    return { kind: "not_ready" };
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
