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
    publishedAt: doc.publishedAt ?? (doc as { updatedAt?: string }).updatedAt ??
      now,
    publishedBy:
      (doc as { publishedBy?: DocVersionRecord["publishedBy"] }).publishedBy ??
        {},
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
