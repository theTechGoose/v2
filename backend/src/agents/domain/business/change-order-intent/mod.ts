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
const CHANGE_ORDER_ALL_RE = new RegExp(CHANGE_ORDER_RE.source, "gi");

/** REQ-438 (demo-loop cycle 3, M7): what right before a phrase denies it —
 *  "no es / not a / isn't a / no change order", "no es una orden de cambio". */
const DENIED_BEFORE_RE =
  /(?:^|[^\p{L}'’])(?:not|isn['’]?t|aren['’]?t|wasn['’]?t|no|nor|never|without|ni|sin|no\s+(?:es|era|sea|quiero|necesito|hagas))\s+(?:(?:a|an|the|any|una?|el|la|ninguna?)\s+)?$/iu;

/** REQ-438: a NEW quote, said outright — "cotización nueva", "nueva
 *  cotización", "presupuesto nuevo", "new / separate / another quote". */
const NEW_QUOTE_ALL_RE =
  /(?<!\p{L})(?:new|separate|another|fresh)\s+(?:quote|estimate|bid)(?!\p{L})|(?<!\p{L})(?:nuev[ao]|otr[ao]|separad[ao])\s+(?:cotizaci[oó]n|presupuesto|estimado)(?!\p{L})|(?<!\p{L})(?:cotizaci[oó]n|presupuesto|estimado)\s+(?:nuev[ao]|separad[ao]|aparte)(?!\p{L})/giu;

/** REQ-438: a message that OPENS as a quote for someone ("Cotización para
 *  María José Peña: …", "Quote for Bryant: …") asks for a quote. */
const LEADING_QUOTE_FOR_RE =
  /^\s*(?:(?:a|an|una?|la)\s+)?(?:quick\s+|r[aá]pida\s+)?(?:quote|estimate|cotizaci[oó]n|presupuesto)(?:\s+r[aá]pid[ao])?\s+(?:for|para)(?!\p{L})/iu;

/** Any match of `re` (global) that is not denied right before it. */
function affirmed(re: RegExp, text: string): boolean {
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
    if (!DENIED_BEFORE_RE.test(before)) return true;
  }
  return false;
}

/** REQ-438: "una cotización NUEVA", "new quote" — not denied ("not a new
 *  quote"). This wins over change-order wording in the same message. */
function saysNewQuote(text: string): boolean {
  return affirmed(NEW_QUOTE_ALL_RE, text);
}

/**
 * REQ-438 (M7): the message asks for a NEW quote — said outright, or opening
 * as "Cotización para … / Quote for …". Pair 6's "Cotización para María José
 * Peña: cambiar la llave … $180" was such a request; the model still called
 * change_order.
 */
export function isNewQuoteRequest(text: string): boolean {
  const s = text ?? "";
  return saysNewQuote(s) ||
    (LEADING_QUOTE_FOR_RE.test(s) && !isChangeOrderRequest(s));
}

/** A change order asked for: "change order" said and not denied ("No es
 *  change order…", REQ-438), and no NEW quote asked for in the same breath. */
export function isChangeOrderRequest(text: string): boolean {
  const s = text ?? "";
  return affirmed(CHANGE_ORDER_ALL_RE, s) && !saysNewQuote(s);
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

// ---------------------------------------------------------------------------
// REQ-377 (demo-loop cycle 2, B1): a NEW TOTAL, not an added amount.
// ---------------------------------------------------------------------------
//
// "Dana wants a tile backsplash too — change Q-001 to $19,750" on an $18,500
// quote is a change order of +$1,250. Nothing read it in code, so the model
// did the subtraction into cents itself, wrote 12500, and a $125 line went
// onto the revision. The total is read here; the coordinator, which knows
// the quote, subtracts.

const MONEY_SRC = String
  .raw`\$\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?`;
const MONEY_ALL_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;

/** What the new total is OF: a quote number, "the total", "the quote". */
const TOTAL_SUBJECT = String
  .raw`(?:(?:the\s+)?(?:total\s+(?:of|on|for)\s+)?Q-\d+(?:'s|’s)?(?:\s+total)?|the\s+(?:(?:quote|job|grand)\s+)?total|the\s+(?:quote|job|price)(?:'s\s+total|\s+total)?|(?:the\s+)?new\s+total)`;

const TARGET_RES: RegExp[] = [
  // "change Q-001 to $19,750", "make the total $19,200", "bring the quote up to $9,800"
  new RegExp(
    String
      .raw`\b(?:change|make|set|bring|update|raise|bump|lower|adjust|put)\s+${TOTAL_SUBJECT}(?:\s+(?:up|down))?(?:\s+(?:to|at|=))?\s*(?:be\s+)?(${MONEY_SRC})`,
    "i",
  ),
  // "new total $19,200", "total should be $19,200"
  new RegExp(
    String
      .raw`\b(?:new\s+)?total\s+(?:(?:should\s+be|is\s+now|will\s+be|is|of|to|=|:)\s*)?(${MONEY_SRC})`,
    "i",
  ),
  // "cambia Q-001 a $19,750", "pon el total en $19,750"
  new RegExp(
    String
      .raw`(?<!\p{L})(?:cambia|cambiar|cambie|pon|ponle|ponla|deja|sube|subir|baja|ajusta)\s+(?:(?:el\s+total\s+de\s+)?(?:la\s+)?Q-\d+|el\s+total|la\s+cotizaci[oó]n)\s+(?:a|en)\s*(${MONEY_SRC})`,
    "iu",
  ),
  // "nuevo total $19,750", "total de $19,750"
  new RegExp(
    String
      .raw`(?<!\p{L})(?:nuevo\s+)?total\s+(?:(?:de|ser[aá]|es|a)\s+)?(${MONEY_SRC})`,
    "iu",
  ),
];

/** What introduces the added work in the rest of the sentence. */
const ITEM_INTRO_RE =
  /^(?:.*?\b(?:wants?|needs?|asked\s+for|would\s+like|is\s+adding)\s+(?:(?:to\s+add|also|too)\s+)?|(?:and\s+|also\s+)?(?:add(?:ing)?|plus|include|including|for|with)\s+|.*?(?<!\p{L})(?:quiere|necesita|pide)\s+(?:tambi[eé]n\s+)?|(?:y\s+)?(?:agrega|agregar|añade|añadir|suma|con|por|para)\s+)(.+)$/iu;
const TRAILING_FILLER_RE =
  /\s+(?:too|also|as\s+well|please|now|tambi[eé]n|por\s+favor)$/i;

function centsOf(money: string): number {
  const m = money.match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/)!;
  return Number(m[1].replace(/,/g, "")) * 100 +
    (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
}

/** Every dollar amount typed, in cents ("$19,750" → 1975000). */
export function typedAmountsCents(text: string): number[] {
  return [...(text ?? "").matchAll(MONEY_ALL_RE)].map((m) => centsOf(m[0]));
}

export interface TargetTotalChange {
  /** "Q-001" when the sentence names one. */
  quoteNumber?: string;
  /** The job's NEW total, integer cents. */
  targetTotalCents: number;
  /** The added work ("Tile backsplash"); absent when none is named. */
  description?: string;
}

/**
 * Read "change Q-001 to $19,750", "make the total $19,200", "new total
 * $9,800", "cambia Q-001 a $19,750" — a new TOTAL for a quote — and the work
 * the sentence adds ("Dana wants a tile backsplash too" → "Tile backsplash").
 * Undefined when the text is not one, or carries more than one dollar
 * amount (then which is the total is not for a regex to guess).
 */
export function parseTargetTotalChange(
  text: string,
): TargetTotalChange | undefined {
  if (!text || typedAmountsCents(text).length !== 1) return undefined;
  for (const re of TARGET_RES) {
    const m = text.match(re);
    if (!m || m.index === undefined) continue;
    const out: TargetTotalChange = { targetTotalCents: centsOf(m[1]) };
    if (out.targetTotalCents <= 0) return undefined;
    const num = text.match(DOC_NUMBER_RE);
    if (num) out.quoteNumber = num[0].toUpperCase();

    const rest = (text.slice(0, m.index) + " " +
      text.slice(m.index + m[0].length))
      .replace(/\(?\bQ-\d+\b\)?/gi, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s.,;:!?¡¿—–-]+|[\s.,;:!?¡¿—–-]+$/g, "")
      .trim();
    const item = rest.match(ITEM_INTRO_RE);
    if (item) {
      let desc = item[1].split(/[.;!?—–]|,\s|\s-\s/)[0].trim();
      while (TRAILING_FILLER_RE.test(desc)) {
        desc = desc.replace(TRAILING_FILLER_RE, "").trim();
      }
      desc = desc.replace(ARTICLE_RE, "").trim();
      if (/\p{L}/u.test(desc)) out.description = capitalize(desc);
    }
    return out;
  }
  return undefined;
}

export type DeltaCheck =
  | { kind: "ok"; deltaCents: number }
  /** the amount fits nothing typed — ask, write nothing */
  | { kind: "ask" };

/**
 * Cross-check the model's change_order delta against the dollars the
 * contractor typed. It stands when it is a typed amount (±$A) or a typed
 * amount minus a base — the job's current total, or a line's price
 * (a reprice on a signed quote, REQ-315). A delta off by a factor of 10 or
 * 100 from exactly one of those is the model's cents slip (demo B1: 12500
 * for 125000) and is corrected. Anything else is asked about. No amount
 * typed → nothing to check against: the delta stands.
 */
export function reconcileChangeOrderDelta(input: {
  deltaCents: number;
  userText: string;
  /** The current total first, then anything else a delta may be measured from. */
  bases: number[];
}): DeltaCheck {
  const delta = Math.trunc(input.deltaCents);
  const amounts = typedAmountsCents(input.userText);
  if (amounts.length === 0) return { kind: "ok", deltaCents: delta };
  const fits = new Set<number>();
  for (const a of amounts) {
    fits.add(a);
    fits.add(-a);
    for (const b of input.bases) fits.add(a - b);
  }
  fits.delete(0);
  if (fits.has(delta)) return { kind: "ok", deltaCents: delta };
  const slips = new Set<number>();
  for (const scaled of [delta * 10, delta * 100, delta / 10, delta / 100]) {
    if (Number.isInteger(scaled) && fits.has(scaled)) slips.add(scaled);
  }
  if (slips.size === 1) return { kind: "ok", deltaCents: [...slips][0] };
  return { kind: "ask" };
}

/** "$180", "$1,850", "$40.50" — whole dollars without cents. */
function dollars(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    })
  }`;
}

/**
 * REQ-438 (demo-loop cycle 3, M7): the examples in the change-order "how
 * much?" question, from the job's OWN amounts. The template carried a fixed
 * "$1,250" / "$19,750" (the REQ-377 demo job), shown on pair 1's $180 lawn
 * job. The added amount is the one typed, else a tenth of the job (whole
 * dollars), else $100; the total is the job's plus that.
 */
export function askAmountExamples(input: {
  currentTotalCents: number;
  /** The dollar amounts typed, in cents (typedAmountsCents). */
  typed: number[];
}): { exampleAdd: string; exampleTotal: string } {
  const total = Math.max(0, Math.trunc(input.currentTotalCents || 0));
  const typed = input.typed.find((c) => c > 0);
  const add = typed ?? (Math.round(total / 10 / 100) * 100 || 10_000);
  return { exampleAdd: dollars(add), exampleTotal: dollars(total + add) };
}
