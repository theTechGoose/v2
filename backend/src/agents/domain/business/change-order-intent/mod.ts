/**
 * REQ-238 (demo M27) — the pure rules behind "Change order for Maria: add
 * fridge cleaning $40" in the assistant.
 *
 * The demo typed that sentence in a new conversation and got a brand-new
 * $40 quote: the assistant only had create_quote, and the coordinator
 * creates a quote whenever no draft is bound. A change order changes an
 * EXISTING job, so the coordinator must (1) recognise the request even when
 * the model reaches for create_quote, (2) read who / what / how much, and
 * (3) find that customer's quote — or ask which one — instead of drafting.
 */

import {
  type LineReprice,
  parseLineReprice,
} from "@agents/domain/business/quote-line-revision/mod.ts";

/** "change order" (any spacing/hyphen, plural) or Spanish "orden de cambio". */
const CHANGE_ORDER_RE =
  /\bchange[\s-]*orders?\b|\b[oó]rden(?:es)?\s+de\s+cambio\b/i;

export function isChangeOrderRequest(text: string): boolean {
  return CHANGE_ORDER_RE.test(text ?? "");
}

export interface ChangeOrderRequest {
  customerName?: string;
  /** REQ-315: an explicit "Q-001" in the request. */
  quoteNumber?: string;
  description?: string;
  /** Signed INTEGER CENTS: + adds to the job, − is a credit. */
  deltaAmountCents?: number;
  /** REQ-315 (M26): "…: change plumbing fixtures to $1,300" sets the price of
   *  a line already on the quote — a reprice, never an added line. When set,
   *  `description` / `deltaAmountCents` are not. */
  reprice?: LineReprice;
}

/** Words that open the "what changed" part; "add"-type ones are dropped. */
const ADD_VERBS =
  /^(?:add(?:ing)?|plus|also|agregar|agrega|añadir|añade|sumar|suma)\b\s*/i;
const CREDIT_VERBS =
  /^(?:remove|drop|take\s+off|credit|deduct|minus|subtract|discount|quitar|quita|descontar|descuenta)\b/i;

const MONEY_RE =
  /(-|−|minus\s+)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/i;

/** The name after "for"/"para", up to three words, stopping at a delimiter,
 *  a verb that opens the change, or (REQ-315) a job reference — "on Q-001",
 *  "about the deck", "re Q-2" — or a bare quote number. */
const CUSTOMER_RE =
  /\b(?:for|para)\s+(?:the\s+|los\s+|la\s+|el\s+)?([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,2}?)(?='s\b|’s\b|\s*[:,;—–]|\s+-\s|\s+(?:add|adding|plus|remove|drop|credit|agregar|agrega|añadir|añade|quitar|quita|she|he|they|ella|él|on|for|about|re|en|sobre)\b|\s+Q-\d+\b|\s*$)/iu;

/** REQ-315: "Q-001" anywhere in the request. */
const DOC_NUMBER_RE = /\bQ-\d+\b/i;
/** REQ-315: "on Q-001" / "about the deck:" between who and what is a job
 *  reference, not the change. */
const JOB_REF_RE = /^\s*(?:on|for|about|re|en|sobre)\b/i;
/** REQ-315: where the change starts when a job reference has no delimiter
 *  ("… on the kitchen job add tile $300"). */
const CHANGE_START_RE =
  /\b(?:add|adding|plus|remove|drop|credit|agregar|agrega|añadir|añade|quitar|quita)\b/i;
/** REQ-315: a leading article on the change ("add a heated floor" → "Heated floor"). */
const ARTICLE_RE = /^(?:a|an|the|un|una|el|la|los|las)\s+/i;

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Read a change-order request. Returns undefined when the text is not one;
 * otherwise whatever of customer / description / amount it carries (any may
 * be missing — the caller decides whether that is enough to act on).
 */
export function parseChangeOrderRequest(
  text: string,
): ChangeOrderRequest | undefined {
  if (!isChangeOrderRequest(text)) return undefined;
  const out: ChangeOrderRequest = {};

  const afterPhrase = text.replace(CHANGE_ORDER_RE, " ").trim();
  const num = afterPhrase.match(DOC_NUMBER_RE);
  if (num) out.quoteNumber = num[0].toUpperCase();

  const cust = afterPhrase.match(CUSTOMER_RE);
  let rest = afterPhrase;
  if (cust) {
    out.customerName = cust[1].trim();
    rest = afterPhrase.slice((cust.index ?? 0) + cust[0].length);
    rest = rest.replace(/^(?:'s|’s)\b/i, "");
  }
  // REQ-315: "on Q-001" / "about the deck:" between who and what is a job
  // reference — drop it, through the number, else through the delimiter,
  // else up to the verb that starts the change.
  const ref = rest.match(JOB_REF_RE);
  if (ref) {
    const afterRef = rest.slice(ref[0].length);
    const n = afterRef.match(/^\s*Q-\d+\b/i);
    const cut = [
      afterRef.search(/[:;—–]|,(?!\d)|\s-\s/), // never the comma in "$1,300"
      afterRef.search(CHANGE_START_RE),
    ].filter((i) => i >= 0);
    if (n) rest = afterRef.slice(n[0].length);
    else if (cut.length > 0) rest = afterRef.slice(Math.min(...cut));
  }
  // drop the separator between "who" and "what"
  rest = rest.replace(/^\s*(?:[:,;—–]|-\s)\s*/, "").trim();

  // REQ-315 (M26): "change plumbing fixtures to $1,300" is a new price for a
  // line that is already there — not "Change plumbing fixtures to" +$1,300.
  const reprice = parseLineReprice(rest);
  if (reprice) {
    out.reprice = reprice;
    return out;
  }

  const money = rest.match(MONEY_RE);
  let negative = false;
  if (money) {
    const whole = Number(money[2].replace(/,/g, ""));
    const frac = money[3] ? Number(money[3].padEnd(2, "0")) : 0;
    negative = Boolean(money[1]);
    rest = (rest.slice(0, money.index) + " " +
      rest.slice((money.index ?? 0) + money[0].length)).trim();
    const cents = whole * 100 + frac;
    if (CREDIT_VERBS.test(rest)) negative = true;
    out.deltaAmountCents = negative ? -cents : cents;
  }

  if (money) {
    // "credit $50 for the missed visit" → "Credit for the missed visit"
    let desc = rest
      .replace(/\(?\bQ-\d+\b\)?/gi, " ") // REQ-315: the number is not the change
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/^[\s.,;:!?—–-]+|[\s.,;:!?—–-]+$/g, "")
      .trim();
    desc = desc.replace(ADD_VERBS, "").trim();
    desc = desc.replace(ARTICLE_RE, "").trim(); // REQ-315
    if (desc) out.description = capitalize(desc);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Which quote does the change order belong to?
// ---------------------------------------------------------------------------

export interface TargetQuote {
  id: string;
  customerId?: string;
  status?: string;
  createdAt: string;
  /** REQ-315: the document number ("Q-001"). */
  number?: string;
}

export interface TargetCustomer {
  id: string;
  name: string;
}

export type ChangeOrderTarget =
  | { kind: "quote"; quoteId: string }
  /** several quotes fit — ask; newest first */
  | { kind: "ambiguous"; quoteIds: string[] }
  /** the named customer has no quote (or no such customer) */
  | { kind: "none" }
  /** nobody named and nothing bound — ask whose job it is */
  | { kind: "ask_customer" };

/** A quote that can no longer take a change. */
const CLOSED = new Set([
  "declined",
  "expired",
  "void",
  "voided",
  "cancelled",
  "canceled",
  "archived",
]);

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenMatch(a: string, b: string): boolean {
  return a === b || a === `${b}s` || b === `${a}s`;
}

/** Does `asked` ("Maria", "maría lopez", "Hendersons") name `customer`? */
export function namesCustomer(asked: string, customer: string): boolean {
  const want = norm(asked).split(" ").filter((w) =>
    w &&
    !["the", "family", "residence", "house", "place", "familia", "casa"]
      .includes(w)
  );
  const have = norm(customer).split(" ").filter(Boolean);
  if (want.length === 0 || have.length === 0) return false;
  return want.every((w) => have.some((h) => tokenMatch(w, h)));
}

function newestFirst(a: TargetQuote, b: TargetQuote): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/** REQ-315: "q-001" and "Q-1" name the same document. */
function docNumberKey(s: string): string {
  return s.trim().toUpperCase().replace(/-0+(\d)/, "-$1");
}

export function pickChangeOrderTarget(input: {
  quotes: TargetQuote[];
  customers: TargetCustomer[];
  customerName?: string;
  /** REQ-315: an explicit number names the quote — no guessing by name. */
  quoteNumber?: string;
  boundQuoteId?: string;
}): ChangeOrderTarget {
  const live = input.quotes.filter((q) => !CLOSED.has(q.status ?? ""));

  if (input.quoteNumber?.trim()) {
    const wanted = docNumberKey(input.quoteNumber);
    const hit = live.find((q) => q.number && docNumberKey(q.number) === wanted);
    return hit ? { kind: "quote", quoteId: hit.id } : { kind: "none" };
  }
  const bound = input.boundQuoteId
    ? live.find((q) => q.id === input.boundQuoteId)
    : undefined;

  if (!input.customerName?.trim()) {
    return bound
      ? { kind: "quote", quoteId: bound.id }
      : { kind: "ask_customer" };
  }

  const matched = new Set(
    input.customers.filter((c) => namesCustomer(input.customerName!, c.name))
      .map((c) => c.id),
  );
  // The conversation's own job wins when it belongs to the named customer.
  if (bound?.customerId && matched.has(bound.customerId)) {
    return { kind: "quote", quoteId: bound.id };
  }
  const theirs = live.filter((q) => q.customerId && matched.has(q.customerId))
    .sort(newestFirst);
  if (theirs.length === 0) return { kind: "none" };

  const open = theirs.filter((q) => (q.status ?? "draft") !== "draft");
  const pool = open.length > 0 ? open : theirs;
  const owners = new Set(pool.map((q) => q.customerId));
  if (owners.size > 1 || open.length > 1) {
    return { kind: "ambiguous", quoteIds: pool.map((q) => q.id) };
  }
  // one customer: their one open quote, else their newest draft
  return { kind: "quote", quoteId: pool[0].id };
}
