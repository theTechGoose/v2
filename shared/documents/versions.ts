/**
 * REQ-201 / REQ-202 / REQ-203 — document versions, locks and balances, pure.
 *
 * A document keeps ONE number and ONE customer-facing link for life. What
 * changes is its version: edits to an issued (sent) document wait as a
 * pending revision until the contractor publishes them, and publishing
 * advances the version (Q-001 · Version 1 → 2 → 3) and files the version it
 * replaces in the document's history. A signed quote and a paid invoice are
 * locked: nothing on them changes any more (scope changes go through change
 * orders; more work gets a new invoice).
 */

export interface VersionedDoc {
  id: string;
  version?: number;
  publishedAt?: string;
  /** Edits made after the document was issued, waiting to be published. */
  pendingRevision?: Record<string, unknown>;
}

/** Rows written before versioning are version 1. */
export function versionOf(
  doc: { version?: number } | null | undefined,
): number {
  const v = doc?.version;
  return typeof v === "number" && v >= 1 ? Math.trunc(v) : 1;
}

/** The fields of a quote the customer sees — the agreement's content. */
export const QUOTE_CONTENT_FIELDS = [
  "customerId",
  "summary",
  "jobName",
  "description",
  "lineItems",
  "estimatedTotal",
  "terms",
  "effectiveDate",
  "startDate",
  "estimatedCompletionDate",
] as const;

/** The fields of an invoice the customer sees — the bill's content. */
export const INVOICE_CONTENT_FIELDS = [
  "customerId",
  "quoteId",
  "jobName",
  "description",
  "lineItems",
  "amount",
  "subtotalCents",
  "discountCents",
  "discountReason",
  "taxRateBp",
  "taxCents",
  "dueDate",
  "issuedDate",
  "netDays",
  "serviceAddress",
  "serviceDateFrom",
  "serviceDateTo",
  "paymentInstructions",
  "billTo",
] as const;

export type QuoteContentField = typeof QUOTE_CONTENT_FIELDS[number];
export type InvoiceContentField = typeof INVOICE_CONTENT_FIELDS[number];

/** Which keys of `patch` are content (customer-visible) fields. */
export function contentKeys(
  patch: Record<string, unknown>,
  fields: readonly string[],
): string[] {
  return Object.keys(patch).filter((k) =>
    fields.includes(k) && patch[k] !== undefined
  );
}

/** Split a patch into the content part and the bookkeeping part. */
export function splitPatch<T extends Record<string, unknown>>(
  patch: T,
  fields: readonly string[],
): { content: Partial<T>; meta: Partial<T> } {
  const content: Record<string, unknown> = {};
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (fields.includes(k)) content[k] = v;
    else meta[k] = v;
  }
  return { content: content as Partial<T>, meta: meta as Partial<T> };
}

/** A quote is issued once it left draft (sent, viewed, accepted, lost). */
export function isQuoteIssued(
  q: { status?: string; sentAt?: string },
): boolean {
  return Boolean(q.sentAt) || (q.status !== undefined && q.status !== "draft");
}

/** REQ-460: why a quote cannot be signed yet. */
export type SignRefusal = "not_issued" | "terms_incomplete";

/**
 * REQ-460 (demo-loop cycle 3, M16 + M15) — a quote is signable once it was
 * put in front of the customer with its payment terms settled. Names what is
 * still missing, or undefined when nothing is (accepted / declined are the
 * accept's own answers, judged before this).
 *  - `not_issued`: it was offered to no one. Locking is not sending (REQ-234):
 *    a locked draft whose terms wizard is still asking was signed in the demo
 *    through the owner's in-person override (REQ-306), which does not change
 *    this. A Send that reached nobody DID offer it — REQ-236 keeps that quote
 *    a draft, and the REQ-310 link is the fallback the contractor pastes.
 *  - `terms_incomplete`: the wizard's answers are on it (REQ-240 writes each
 *    one as it is given) but the payment terms are not — what the signature
 *    bills is not decided yet. A quote written over the API with no wizard
 *    terms at all bills its whole total at signing (REQ-240).
 * The onboarding sample (REQ-256) is a draft by design — it shows the owner
 * what their customer's page looks like, pad included — so it is not judged.
 */
export function quoteSignRefusal(
  q: {
    status?: string;
    sentAt?: string;
    lastDelivery?: unknown;
    terms?: readonly { stepId?: string }[];
    isSample?: boolean;
  },
): SignRefusal | undefined {
  if (q.isSample === true) return undefined;
  if (!isQuoteIssued(q) && !q.lastDelivery) return "not_issued";
  const terms = q.terms ?? [];
  if (terms.length > 0 && !terms.some((t) => t.stepId === "payment_terms")) {
    return "terms_incomplete";
  }
  return undefined;
}

/** A signed quote is locked (REQ-202): its content never changes again. */
export function isQuoteLocked(
  q: { status?: string; acceptedAt?: string },
): boolean {
  return q.status === "accepted" || Boolean(q.acceptedAt);
}

/** An invoice is issued once it is in front of the customer. */
export function isInvoiceIssued(i: { status?: string }): boolean {
  return i.status !== undefined && i.status !== "draft" &&
    i.status !== "scheduled";
}

/** A paid invoice is locked (REQ-202): more work gets a new invoice. */
export function isInvoiceLocked(i: { status?: string }): boolean {
  return i.status === "paid";
}

export type EditDecision =
  /** the document is a draft — the edit lands on the live record */
  | { mode: "apply" }
  /** the document is issued — the edit waits as a pending revision */
  | { mode: "pending"; fields: string[] }
  /** the document is locked — the content edit is refused */
  | {
    mode: "locked";
    reason: "locked_signed" | "locked_paid";
    fields: string[];
  };

export function quoteEditDecision(
  q: { status?: string; sentAt?: string; acceptedAt?: string },
  patch: Record<string, unknown>,
): EditDecision {
  const fields = contentKeys(patch, QUOTE_CONTENT_FIELDS);
  if (fields.length === 0) return { mode: "apply" };
  if (isQuoteLocked(q)) {
    return { mode: "locked", reason: "locked_signed", fields };
  }
  if (isQuoteIssued(q)) return { mode: "pending", fields };
  return { mode: "apply" };
}

export function invoiceEditDecision(
  i: { status?: string },
  patch: Record<string, unknown>,
): EditDecision {
  const fields = contentKeys(patch, INVOICE_CONTENT_FIELDS);
  if (fields.length === 0) return { mode: "apply" };
  if (isInvoiceLocked(i)) {
    return { mode: "locked", reason: "locked_paid", fields };
  }
  if (isInvoiceIssued(i)) return { mode: "pending", fields };
  return { mode: "apply" };
}

/** One filed version of a document: the content as it was published. */
export interface DocVersionRecord<T = Record<string, unknown>> {
  version: number;
  /** when this version became the live one */
  publishedAt: string;
  /** who published it */
  publishedBy: { userId?: string; name?: string; customer?: boolean };
  /** when it stopped being the live one */
  supersededAt: string;
  content: T;
}

/**
 * Publish a revision: the current content is filed as the version it was,
 * the patch lands on the live record, the version advances, the pending
 * revision is consumed. `now` and `by` are the publication's stamp.
 */
export function applyRevision<T extends VersionedDoc & Record<string, unknown>>(
  doc: T,
  patch: Record<string, unknown>,
  by: DocVersionRecord["publishedBy"],
  now: string,
): { next: T; filed: DocVersionRecord } {
  const { pendingRevision: _pending, ...content } = doc;
  const filed: DocVersionRecord = {
    version: versionOf(doc),
    // REQ-248: a version issued before the first-issue stamp existed was
    // published by its owner when it was sent — never an anonymous {}.
    publishedAt: doc.publishedAt ?? (doc as { sentAt?: string }).sentAt ??
      (doc as { updatedAt?: string }).updatedAt ?? now,
    publishedBy: publisherOrOwner(
      doc as {
        userId?: unknown;
        publishedBy?: DocVersionRecord["publishedBy"];
      },
    ),
    supersededAt: now,
    content,
  };
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([_, v]) => v !== undefined),
  );
  const next = {
    ...doc,
    ...defined,
    version: versionOf(doc) + 1,
    publishedAt: now,
    publishedBy: by,
    updatedAt: now,
  } as T;
  delete (next as Record<string, unknown>).pendingRevision;
  return { next, filed };
}

/** REQ-248: the stamped publisher, else the document's owner, else nobody. */
export function publisherOrOwner(
  doc: { userId?: unknown; publishedBy?: DocVersionRecord["publishedBy"] },
): DocVersionRecord["publishedBy"] {
  const by = doc.publishedBy;
  if (by && Object.keys(by).length > 0) return by;
  return typeof doc.userId === "string" && doc.userId
    ? { userId: doc.userId }
    : {};
}

/**
 * REQ-248: the first issue IS version 1's publication. When a patch stamps
 * `sentAt` on a document that was never published, it also stamps
 * `publishedAt` (= sentAt) and `publishedBy` (the given publisher, else the
 * owner) — once; a later send never re-stamps.
 */
export function firstIssueStamp(
  existing: {
    userId?: string;
    publishedAt?: string;
    publishedBy?: DocVersionRecord["publishedBy"];
  },
  patch: { sentAt?: unknown },
  by?: DocVersionRecord["publishedBy"],
): { publishedAt?: string; publishedBy?: DocVersionRecord["publishedBy"] } {
  if (typeof patch.sentAt !== "string" || !patch.sentAt) return {};
  if (existing.publishedAt) return {};
  return {
    publishedAt: patch.sentAt,
    publishedBy: by && Object.keys(by).length > 0
      ? by
      : publisherOrOwner({ userId: existing.userId }),
  };
}

/**
 * REQ-248: an issued, unsigned quote carrying a pending edit — the customer
 * still sees the published version, and sending publishes the next one.
 */
export function pendingRevisionNotice(
  q:
    | {
      status?: string;
      sentAt?: string | null;
      acceptedAt?: string | null;
      version?: number;
      pendingRevision?: Record<string, unknown>;
    }
    | null
    | undefined,
): { nextVersion: number } | null {
  if (!q) return null;
  const pending = q.pendingRevision;
  if (!pending || Object.keys(pending).length === 0) return null;
  const lifecycle = {
    status: q.status,
    sentAt: q.sentAt ?? undefined,
    acceptedAt: q.acceptedAt ?? undefined,
  };
  if (!isQuoteIssued(lifecycle) || isQuoteLocked(lifecycle)) return null;
  return { nextVersion: versionOf(q) + 1 };
}

/** REQ-395 (demo m24): one line as a change summary names it — description + line total. */
export interface LineSummary {
  description: string;
  totalCents: number;
}

/** REQ-248: what one version changed against the one before it. */
export interface VersionChanges {
  totalFromCents?: number;
  totalToCents?: number;
  linesAdded: number;
  linesRemoved: number;
  linesChanged: number;
  /** REQ-395: the lines added / removed / changed, by name (present when any). */
  added?: LineSummary[];
  removed?: LineSummary[];
  changed?: { from: LineSummary; to: LineSummary }[];
}

interface LineLike {
  description?: string;
  quantity?: number;
  unit?: string;
  price?: number;
}

/**
 * REQ-248: compare two versions' content — the total (`estimatedTotal` for a
 * quote, `amount` for an invoice) and the line items, matched by position:
 * the lines both have are "changed" when any of description / quantity /
 * unit / price differs; the rest were added or removed.
 */
export function versionChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): VersionChanges {
  const totalOf = (c: Record<string, unknown> | null | undefined) => {
    const t = c?.estimatedTotal ?? c?.amount;
    return typeof t === "number" ? t : undefined;
  };
  const linesOf = (c: Record<string, unknown> | null | undefined) =>
    Array.isArray(c?.lineItems) ? (c!.lineItems as LineLike[]) : [];
  const from = totalOf(before);
  const to = totalOf(after);
  const a = linesOf(before);
  const b = linesOf(after);
  const shared = Math.min(a.length, b.length);
  const changed: { from: LineSummary; to: LineSummary }[] = [];
  for (let i = 0; i < shared; i++) {
    const x = a[i] ?? {};
    const y = b[i] ?? {};
    if (!sameLine(x, y)) {
      changed.push({ from: lineSummary(x), to: lineSummary(y) });
    }
  }
  const added = b.slice(shared).map(lineSummary);
  const removed = a.slice(shared).map(lineSummary);
  return {
    ...(from !== to
      ? { totalFromCents: from ?? 0, totalToCents: to ?? 0 }
      : {}),
    linesAdded: added.length,
    linesRemoved: removed.length,
    linesChanged: changed.length,
    ...(added.length ? { added } : {}),
    ...(removed.length ? { removed } : {}),
    ...(changed.length ? { changed } : {}),
  };
}

function sameLine(x: LineLike, y: LineLike): boolean {
  return (x.description ?? "") === (y.description ?? "") &&
    (x.quantity ?? 1) === (y.quantity ?? 1) &&
    (x.unit ?? "") === (y.unit ?? "") &&
    (x.price ?? 0) === (y.price ?? 0);
}

function lineSummary(l: LineLike): LineSummary {
  const qty = typeof l.quantity === "number" ? l.quantity : 1;
  const price = typeof l.price === "number" ? l.price : 0;
  return {
    description: (l.description ?? "").trim(),
    totalCents: Math.round(price * qty),
  };
}

function linesOfValue(v: unknown): LineLike[] {
  return Array.isArray(v) ? (v as LineLike[]) : [];
}

/** Order-insensitive structural equality for plain JSON-ish values. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length &&
      a.every((x, i) => sameValue(x, b[i]));
  }
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set(
      [...Object.keys(ao), ...Object.keys(bo)].filter((k) =>
        ao[k] !== undefined || bo[k] !== undefined
      ),
    );
    return [...keys].every((k) => sameValue(ao[k], bo[k]));
  }
  return false;
}

/**
 * REQ-395 (demo M12): the part of a pending revision that actually differs
 * from the live record. Line items compare on what the customer sees
 * (description / quantity / unit / price, by position) — the live rows carry
 * translations the editor never sends — and every other field structurally.
 * `{}` means the revision is the live version: nothing to publish.
 */
export function effectivePendingRevision(
  live: Record<string, unknown> | null | undefined,
  pending: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pending ?? {})) {
    if (v === undefined) continue;
    if (k === "lineItems") {
      const a = linesOfValue(live?.lineItems);
      const b = linesOfValue(v);
      if (
        a.length === b.length &&
        a.every((x, i) => sameLine(x ?? {}, b[i] ?? {}))
      ) {
        continue;
      }
    } else if (sameValue(live?.[k], v)) continue;
    out[k] = v;
  }
  return out;
}

/** The fields whose change the line summary already says. */
const LINE_SUMMARY_FIELDS = new Set(["lineItems", "estimatedTotal", "amount"]);

/**
 * REQ-395 (demo M12): does the pending revision change anything the line
 * summary does not say — wording, terms, dates? Only then may the publish
 * box read "Wording or terms updated".
 */
export function pendingOtherContentChanged(
  doc:
    | (Record<string, unknown> & { pendingRevision?: Record<string, unknown> })
    | null
    | undefined,
): boolean {
  if (!doc?.pendingRevision) return false;
  const { pendingRevision, ...live } = doc;
  return Object.keys(effectivePendingRevision(live, pendingRevision)).some(
    (k) => !LINE_SUMMARY_FIELDS.has(k),
  );
}

/**
 * REQ-304: what publishing the pending revision would change — the live
 * record against the live record with the pending revision folded in, so a
 * pending revision that only carries the total never reads as "lines
 * removed". `null` when nothing is pending.
 */
export function pendingRevisionChanges(
  doc:
    | (Record<string, unknown> & { pendingRevision?: Record<string, unknown> })
    | null
    | undefined,
): VersionChanges | null {
  const pending = doc?.pendingRevision;
  if (!doc || !pending || Object.keys(pending).length === 0) return null;
  const { pendingRevision: _p, ...live } = doc;
  return versionChanges(live, { ...live, ...pending });
}

/** REQ-466 (demo m38): one row of the draft revision's line list. */
export interface DraftLine {
  description: string;
  quantity: number;
  unit: string;
  totalCents: number;
}

/**
 * REQ-466 (demo m38): the draft revision as the contractor will publish it —
 * its line items (the live ones when the draft does not touch them) and its
 * total. `null` when nothing is pending.
 */
export function pendingDraftLines(
  doc:
    | (Record<string, unknown> & { pendingRevision?: Record<string, unknown> })
    | null
    | undefined,
): { lines: DraftLine[]; totalCents?: number } | null {
  const pending = doc?.pendingRevision;
  if (!doc || !pending || Object.keys(pending).length === 0) return null;
  const { pendingRevision: _p, ...live } = doc;
  const draft = { ...live, ...pending };
  const lines = linesOfValue(draft.lineItems).map((l) => {
    const quantity = typeof l?.quantity === "number" ? l.quantity : 1;
    return {
      description: (l?.description ?? "").trim(),
      quantity,
      unit: l?.unit ?? "",
      totalCents: lineSummary(l ?? {}).totalCents,
    };
  });
  const total = draft.estimatedTotal ?? draft.amount;
  return typeof total === "number" ? { lines, totalCents: total } : { lines };
}

/** What a customer sees, with the pending revision folded in (the contractor's working copy). */
export function workingCopy<T extends VersionedDoc>(doc: T): T {
  if (!doc.pendingRevision) return doc;
  const { pendingRevision, ...live } = doc;
  return { ...live, ...pendingRevision, pendingRevision } as T;
}

/** REQ-202: one bill, one current balance. Partial payments count down; an overpayment is flagged, never hidden. */
export function invoiceBalance(
  amountCents: number | undefined,
  paidCents: number | undefined,
): {
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  overpaidCents: number;
} {
  const amount = Math.max(0, Math.round(amountCents ?? 0));
  const paid = Math.max(0, Math.round(paidCents ?? 0));
  return {
    amountCents: amount,
    paidCents: paid,
    balanceCents: Math.max(0, amount - paid),
    overpaidCents: Math.max(0, paid - amount),
  };
}

/** The headline state a document shows next to its number and version. */
export type DocState =
  | "draft"
  /** REQ-481: an installment waiting for its send day — not a draft */
  | "scheduled"
  | "sent"
  | "accepted"
  | "declined"
  | "revised"
  | "claimed"
  | "paid"
  | "void"
  | "approved"
  | "pending";

export function quoteState(
  q: { status?: string; acceptedAt?: string; version?: number },
): DocState {
  if (isQuoteLocked(q)) return "accepted";
  if (q.status === "lost") return "declined";
  if (!isQuoteIssued(q)) return "draft";
  return versionOf(q) > 1 ? "revised" : "sent";
}

/** The lifecycle pill on the open-quote panel (roadmap p.10). */
export type QuoteBadgeStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "revised"
  | "accepted"
  | "declined";

/** REQ-467 (demo p8-pair5-a): the panel pill derives from quoteState, so it
 *  says "Revised" whenever the document line does. The only extra word it
 *  carries is "viewed" — the client opened a Version 1 quote. */
export function quoteBadgeStatus(
  q: {
    status?: string;
    acceptedAt?: string;
    sentAt?: string;
    version?: number;
  },
): QuoteBadgeStatus {
  const raw = typeof q.status === "string" ? q.status.toLowerCase() : "";
  const state = quoteState({ ...q, status: raw || undefined });
  if (state === "sent" && raw === "viewed") return "viewed";
  return state as QuoteBadgeStatus;
}

export function invoiceState(
  i: { status?: string; version?: number },
): DocState {
  if (i.status === "paid") return "paid";
  if (i.status === "void") return "void";
  if (i.status === "claimed") return "claimed";
  // REQ-481 (demo M28/m10): a scheduled installment reads "Scheduled", never "Draft".
  if (i.status === "scheduled") return "scheduled";
  if (!isInvoiceIssued(i)) return "draft";
  return versionOf(i) > 1 ? "revised" : "sent";
}
