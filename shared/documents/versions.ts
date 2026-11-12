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
      sentAt?: string;
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
    sentAt: q.sentAt,
    acceptedAt: q.acceptedAt ?? undefined,
  };
  if (!isQuoteIssued(lifecycle) || isQuoteLocked(lifecycle)) return null;
  return { nextVersion: versionOf(q) + 1 };
}

/** REQ-248: what one version changed against the one before it. */
export interface VersionChanges {
  totalFromCents?: number;
  totalToCents?: number;
  linesAdded: number;
  linesRemoved: number;
  linesChanged: number;
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
  let linesChanged = 0;
  for (let i = 0; i < shared; i++) {
    const x = a[i] ?? {};
    const y = b[i] ?? {};
    if (
      (x.description ?? "") !== (y.description ?? "") ||
      (x.quantity ?? 1) !== (y.quantity ?? 1) ||
      (x.unit ?? "") !== (y.unit ?? "") ||
      (x.price ?? 0) !== (y.price ?? 0)
    ) linesChanged++;
  }
  return {
    ...(from !== to
      ? { totalFromCents: from ?? 0, totalToCents: to ?? 0 }
      : {}),
    linesAdded: Math.max(0, b.length - a.length),
    linesRemoved: Math.max(0, a.length - b.length),
    linesChanged,
  };
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

export function invoiceState(
  i: { status?: string; version?: number },
): DocState {
  if (i.status === "paid") return "paid";
  if (i.status === "void") return "void";
  if (i.status === "claimed") return "claimed";
  if (!isInvoiceIssued(i)) return "draft";
  return versionOf(i) > 1 ? "revised" : "sent";
}
