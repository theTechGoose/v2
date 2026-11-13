/**
 * REQ-198 / REQ-199 — document numbering rules, pure.
 *
 * Every DocuMonster client (an account) has one unique account number, and
 * under it every customer, quote, invoice, change order and work order
 * carries its own sequential number. Sequences are PER ACCOUNT: two
 * accounts can both have `INV-001` without touching each other. A sequence
 * defaults to 001; the account can pick a different starting number in
 * Settings before its first document of that kind is issued, after which
 * the sequence is locked and only advances. An issued number is never
 * reused.
 *
 * The storage side (the atomic per-account counters) lives in
 * backend/src/core/data/doc-numbering; this module is the formatting and
 * validation shared by the backend, the front end and the tests.
 */

export const DOC_KINDS = [
  "customer",
  "quote",
  "invoice",
  "changeOrder",
  "workOrder",
] as const;
export type DocKind = typeof DOC_KINDS[number];

/** The prefix each kind's number carries ("INV-001"). */
export const DOC_PREFIX: Record<DocKind, string> = {
  customer: "C",
  quote: "Q",
  invoice: "INV",
  changeOrder: "CO",
  workOrder: "WO",
};

/** The account number's prefix ("DM-0001"). */
export const ACCOUNT_PREFIX = "DM";

/** Every sequence starts here unless Settings says otherwise. */
export const DEFAULT_START = 1;
/** The largest starting number Settings accepts. */
export const MAX_START = 99_999_999;
/** Numbers are padded to at least this many digits ("001", "5000"). */
export const MIN_DIGITS = 3;

export function isDocKind(value: unknown): value is DocKind {
  return typeof value === "string" &&
    (DOC_KINDS as readonly string[]).includes(value);
}

/** "INV-001", "INV-5000", "Q-1000000" — padded to three digits, never truncated. */
export function formatDocNumber(kind: DocKind, seq: number): string {
  return `${DOC_PREFIX[kind]}-${padSeq(seq)}`;
}

/** "DM-0001" — the account's own number, padded to four digits. */
export function formatAccountNumber(seq: number): string {
  return `${ACCOUNT_PREFIX}-${
    String(Math.max(1, Math.trunc(seq))).padStart(4, "0")
  }`;
}

export function padSeq(seq: number): string {
  return String(Math.max(1, Math.trunc(seq))).padStart(MIN_DIGITS, "0");
}

/**
 * A starting number typed in Settings: a positive integer up to MAX_START,
 * accepted as a number or a digit string ("5000"). Anything else → null.
 */
export function parseStartingNumber(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  if (n < 1 || n > MAX_START) return null;
  return n;
}

/** The per-kind starting numbers an account may set once (Settings). */
export interface NumberingStarts {
  customerStart?: number;
  quoteStart?: number;
  invoiceStart?: number;
  changeOrderStart?: number;
  workOrderStart?: number;
}

export const START_FIELD: Record<DocKind, keyof NumberingStarts> = {
  customer: "customerStart",
  quote: "quoteStart",
  invoice: "invoiceStart",
  changeOrder: "changeOrderStart",
  workOrder: "workOrderStart",
};

/** Where `kind`'s sequence begins for this account: its setting, else 001. */
export function startFor(
  settings: NumberingStarts | null | undefined,
  kind: DocKind,
): number {
  const v = settings?.[START_FIELD[kind]];
  return parseStartingNumber(v) ?? DEFAULT_START;
}

/**
 * The number a document shows. Rows written before numbering existed carry
 * no `number`; they keep the old derived reference (`#` + the first eight
 * characters of the id, upper-cased) so nothing they were sent under changes.
 */
export function docNumberOf(doc: { number?: string; id: string }): string {
  if (typeof doc.number === "string" && doc.number.trim()) return doc.number;
  return `#${doc.id.slice(0, 8).toUpperCase()}`;
}

/**
 * REQ-241: the number the assistant's review card shows for `docId` — the
 * fetched quote's own number ("Q-001", the one every document carries) when
 * that quote is this one; the old hex reference only when none is known.
 */
export function reviewCardNumber(
  docId: string,
  quote: { id?: string; number?: string } | null | undefined,
): string {
  return docNumberOf({
    id: docId,
    number: quote && quote.id === docId ? quote.number : undefined,
  });
}

/**
 * REQ-465 (demo cycle 3, m37): the Q- number a chat action card shows — the
 * card's own `number` (the backend stamps it on draft / locked cards), else
 * the fetched quote's when that quote is the card's. Undefined when neither
 * is known; the card then shows its status alone (never the hex id).
 */
export function actionCardNumber(
  payload: { quoteId?: string; number?: string } | null | undefined,
  quote: { id?: string; number?: string } | null | undefined,
): string | undefined {
  const own = payload?.number?.trim();
  if (own) return own;
  if (!payload?.quoteId || !quote || quote.id !== payload.quoteId) {
    return undefined;
  }
  return quote.number?.trim() || undefined;
}

/** REQ-465: "Q-001 · Quote locked" — `label` led by the number when known. */
export function numberedLabel(
  number: string | null | undefined,
  label: string,
): string {
  const n = number?.trim();
  return n ? `${n} · ${label}` : label;
}

/**
 * Does `query` name this number? Full or partial, case-insensitive, with or
 * without the prefix or dash: "inv-5", "5000", "INV5000" and "5" all hit
 * "INV-5000"; "600" does not.
 */
export function matchesDocNumber(
  number: string | undefined,
  query: string,
): boolean {
  if (!number) return false;
  const q = fold(query);
  if (!q) return false;
  const n = fold(number);
  if (n.includes(q)) return true;
  const prefix = n.match(/^[a-z]+/)?.[0] ?? "";
  const qPrefix = q.match(/^[a-z]+/)?.[0] ?? "";
  // "q-5" never names INV-5000: a typed prefix must be the number's own
  if (qPrefix && !prefix.startsWith(qPrefix)) return false;
  const digits = n.slice(prefix.length);
  const qDigits = q.slice(qPrefix.length);
  if (!qDigits || /[a-z]/.test(qDigits)) return false;
  // "5" names INV-005 and INV-5000 alike: compare without the padding
  return digits.replace(/^0+/, "").startsWith(qDigits.replace(/^0+/, "")) ||
    digits.includes(qDigits);
}

function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
