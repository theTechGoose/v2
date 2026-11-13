/**
 * REQ-315 (demo-loop cycle 1, B2) — the pure rules behind "Edit → Version
 * N+1" on an issued quote's panel (/quotes?open=…).
 *
 * Demo pair 5 sent Q-001 and then found "NO Edit, no New version, no Change
 * order button" on it. The server already files a content edit on an issued
 * quote as a pending revision (REQ-201: PUT /quotes/:id → pendingRevision,
 * POST /quotes/:id/publish → Version N+1); this gives the panel the rows to
 * edit and the body to send.
 */
import {
  isQuoteIssued,
  isQuoteLocked,
  versionOf,
} from "../../shared/documents/versions.ts";

/** One editor row — strings because they are bound to inputs; price in dollars. */
export interface EditableQuoteLine {
  description: string;
  quantity: string;
  unit: string;
  price: string;
  /** REQ-264: the line's translations as loaded. Publishing a revision does
   *  not re-translate, so they ride along while the wording is unchanged. */
  descriptionByLang?: Record<string, string>;
  /** The wording those translations belong to. */
  translatedFrom?: string;
}

/** An issued, unsigned, undecided, real quote can be revised; nothing else. */
export function canReviseQuote(
  q:
    | {
      status?: string;
      sentAt?: string;
      acceptedAt?: string;
      isSample?: boolean;
    }
    | null
    | undefined,
): boolean {
  if (!q || q.isSample === true) return false;
  const status = (q.status ?? "").toLowerCase();
  if (status === "lost" || status === "declined" || status === "void") {
    return false;
  }
  return isQuoteIssued({ status: q.status, sentAt: q.sentAt }) &&
    !isQuoteLocked({ status: q.status, acceptedAt: q.acceptedAt });
}

/** The version an edit becomes: version + 1 (2 for an unversioned row). */
export function nextVersionOf(
  q: { version?: number } | null | undefined,
): number {
  return versionOf(q) + 1;
}

function dollars(cents: number): string {
  const d = cents / 100;
  return String(Number.isInteger(d) ? d : Math.round(d * 100) / 100);
}

/**
 * The rows to edit: the working copy — the pending revision's lines when
 * one exists (REQ-201), else the live lines.
 */
export function editableLines(
  q:
    | { lineItems?: unknown; pendingRevision?: Record<string, unknown> }
    | null
    | undefined,
): EditableQuoteLine[] {
  if (!q) return [];
  const pending = q.pendingRevision?.lineItems;
  const raw = Array.isArray(pending)
    ? pending
    : Array.isArray(q.lineItems)
    ? q.lineItems
    : [];
  return raw.map((li) => {
    const row = (li ?? {}) as Record<string, unknown>;
    const qty = typeof row.quantity === "number" && row.quantity > 0
      ? row.quantity
      : 1;
    const description = typeof row.description === "string"
      ? row.description
      : "";
    const byLang = row.descriptionByLang;
    const translated = byLang && typeof byLang === "object" &&
        Object.keys(byLang).length > 0
      ? { ...(byLang as Record<string, string>) }
      : undefined;
    return {
      description,
      quantity: String(qty),
      unit: typeof row.unit === "string" && row.unit ? row.unit : "ea",
      price: typeof row.price === "number" ? dollars(row.price) : "",
      ...(translated
        ? { descriptionByLang: translated, translatedFrom: description }
        : {}),
    };
  });
}

/** The editor's running total in cents — rows that don't parse count 0. */
export function editorTotalCents(
  lines: readonly { quantity: string; price: string }[],
): number {
  return lines.reduce((sum, l) => {
    const price = l.price.trim() === "" ? NaN : Number(l.price);
    const qty = Number(l.quantity);
    return Number.isFinite(price) && Number.isFinite(qty)
      ? sum + Math.round(price * 100) * qty
      : sum;
  }, 0);
}

/** One line of the PUT /quotes/:id body. */
export interface PatchedQuoteLine {
  description: string;
  quantity: number;
  unit: string;
  /** Per-unit price, integer cents. */
  price: number;
  /** Kept only while the wording is the one it translates (REQ-264). */
  descriptionByLang?: Record<string, string>;
}

export type LinesPatch =
  | { ok: true; lineItems: PatchedQuoteLine[]; estimatedTotal: number }
  | { ok: false; reason: "empty" | "invalid" };

/** The PUT /quotes/:id body: integer cents per unit and the new total. */
export function linesPatch(
  lines: readonly {
    description: string;
    quantity: string;
    unit?: string;
    price: string;
    descriptionByLang?: Record<string, string>;
    translatedFrom?: string;
  }[],
): LinesPatch {
  if (lines.length === 0) return { ok: false, reason: "empty" };
  const lineItems: PatchedQuoteLine[] = [];
  for (const l of lines) {
    const description = (l.description ?? "").trim();
    const quantity = Number(l.quantity);
    const priceText = String(l.price ?? "").trim();
    const price = priceText === "" ? NaN : Number(priceText);
    if (
      !description || !Number.isFinite(quantity) || quantity <= 0 ||
      !Number.isFinite(price)
    ) {
      return { ok: false, reason: "invalid" };
    }
    const sameWording = l.descriptionByLang !== undefined &&
      (l.translatedFrom ?? "").trim() === description;
    lineItems.push({
      description,
      quantity,
      unit: (l.unit ?? "").trim() || "ea",
      price: Math.round(price * 100),
      ...(sameWording ? { descriptionByLang: { ...l.descriptionByLang } } : {}),
    });
  }
  return {
    ok: true,
    lineItems,
    estimatedTotal: lineItems.reduce((s, l) => s + l.price * l.quantity, 0),
  };
}

/** REQ-565 (demo-loop cycle 4, m33): what the "Revision published" note was
 *  true of — the version Publish made, the quote's status then, and how many
 *  change orders the ledger held. */
export interface PublishedMark {
  version: number;
  status: string;
  changeOrders: number;
}

/**
 * REQ-565 (m33): "Revision published — the customer got the same link again."
 * used to stay up until the panel remounted, through the customer signing and
 * a change order being made. It shows only while the ledger is still the one
 * that publish produced: same status, same change orders, no later version
 * (the reload that brings the new version in keeps it; anything after drops it).
 */
export function publishedNoteVisible(
  mark: PublishedMark | null,
  now: PublishedMark,
): boolean {
  if (!mark) return false;
  return now.status === mark.status &&
    now.changeOrders === mark.changeOrders &&
    now.version <= mark.version;
}

/**
 * REQ-561 (demo-loop cycle 4, M28): the job-detail bullets the customer
 * reads (quote.description, one bullet per line) as the editor starts them —
 * the pending revision's text when one is waiting, else the live text.
 */
export function editableJobDetails(
  q:
    | { description?: unknown; pendingRevision?: Record<string, unknown> }
    | null
    | undefined,
): string {
  if (!q) return "";
  const pending = q.pendingRevision?.description;
  if (typeof pending === "string") return pending;
  return typeof q.description === "string" ? q.description : "";
}

/** One bullet per line: each line trimmed, blank lines dropped. */
function jobDetailsText(text: string): string {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

/**
 * REQ-561 (M28): the save body's part for the job details — `{ description }`
 * when the text really changed from what the editor started with, else `{}`
 * (so a line-only edit never touches the bullets or their translations).
 */
export function jobDetailsPatch(
  initial: string,
  current: string,
): { description?: string } {
  const next = jobDetailsText(current);
  return next === jobDetailsText(initial) ? {} : { description: next };
}
