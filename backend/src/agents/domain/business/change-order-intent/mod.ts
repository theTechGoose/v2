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
  findLine,
  type LineReprice,
  parseLineReprice,
} from "@agents/domain/business/quote-line-revision/mod.ts";
import { moneyAmounts } from "#quote-flow/money-amounts.ts";

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
  /** REQ-661 (demo-loop cycle 5, M15): "heated floor is $1,200 not 150" —
   *  `deltaAmountCents` is the line's RIGHT price. A line by that name already
   *  on the job is repriced to it; with none, it is added at that price. */
  setsLinePrice?: boolean;
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

/** REQ-455 (M24): longest item clause read in code, in words. */
const MAX_CLAUSE_WORDS = 8;
/** REQ-455 (M24): words that make a clause a story about the job, not the
 *  item — who signed, who wants what, what to do with the document. */
const NARRATIVE_RE =
  /(?<!\p{L})(?:signed|accepted|approved|agreed|wants?|wanted|needs?|asked|would\s+like|make\s+(?:a|an|the|it|me)|send|sent|email|text\s+(?:it|her|him|them)|she|he|they|her|him|them|i|we|you|my|please|quiere|quieren|firm[oó]|aprob[oó]|env[ií]a|enviar|env[ií]ale|manda|mandar|m[aá]ndale|haz|ella|[eé]l|ellos|ellas)(?!\p{L})/iu;

/**
 * REQ-455 (demo-loop cycle 3, M24): is this change clause a short,
 * well-formed item ("Fridge cleaning", "Credit for the missed visit") that
 * code may store as the change order's description? Not when it runs past
 * eight words, holds a sentence break, or tells a story ("Karen signed but
 * now she wants…", "make a …", "send it to her") — that is the model's job.
 */
export function isCleanChangeClause(text: string): boolean {
  const clause = (text ?? "").trim();
  if (!clause) return false;
  if (clause.split(/\s+/).length > MAX_CLAUSE_WORDS) return false;
  if (/[.!?]\s/.test(clause)) return false;
  // REQ-661 (M15): "heated floor for the hendersons is not 150" — a copula,
  // "not N" or "instead of" makes it a sentence (a correction), not an item.
  if (COPULA_RE.test(clause) || CORRECTION_WORD_RE.test(clause)) return false;
  return !NARRATIVE_RE.test(clause);
}

/** REQ-661 (demo-loop cycle 5, M15): a verb "to be" — an item's name never
 *  holds one ("Heated floor is 1200" is a sentence about the item). */
const COPULA_RE =
  /(?<!\p{L})(?:is|isn['’]?t|are|was|were|should\s+be|es|son|era|eran|est[aá]|deber[ií]a\s+ser|debe\s+ser)(?!\p{L})/iu;
/** REQ-661: a correction — "not 150", "no $150", "instead of", "en vez de". */
const CORRECTION_WORD_RE =
  /(?<!\p{L})(?:(?:not|no)\s+\$?\s?\d|instead\s+of|rather\s+than|en\s+vez\s+de|en\s+lugar\s+de)/iu;

export interface LineCorrection {
  /** The line as named ("heated floor"), article and customer dropped. */
  item: string;
  /** "for the hendersons" inside the clause — who the job is for. */
  customerName?: string;
  /** The RIGHT price, integer cents. */
  amountCents: number;
  /** The wrong one it replaces, integer cents. */
  previousCents: number;
}

// REQ-755 (cycle 5v1, M15): the right price may be typed bare ("is 275 not
// 200") — a size or a count after either number rules it out (UNIT_AFTER_RE).
const CORR_MONEY = String
  .raw`\$?\s?(?<whole>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?<frac>\d{1,2}))?`;
const CORR_OLD = String
  .raw`\$?\s?(?<oldWhole>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?<oldFrac>\d{1,2}))?`;
/** "<item> is $1,200 not 150", "<item> should be $1,200, not $150",
 *  "<item> is $900 instead of $700", "el <item> es $1,200, no 150". */
const LINE_CORRECTION_RE = new RegExp(
  String
    .raw`^\s*(?:(?:no|oops|sorry|actually|wait|correction|perd[oó]n|en\s+realidad)[,!]?\s+)*(?<line>[^$\n.:;!?]+?)\s+(?:is|should\s+be|was\s+supposed\s+to\s+be|=|es|debe\s+ser|deber[ií]a\s+ser|cuesta)\s+(?:actually\s+|really\s+|en\s+realidad\s+)?${CORR_MONEY}\s*,?\s+(?:not|no|instead\s+of|rather\s+than|en\s+vez\s+de|en\s+lugar\s+de|y\s+no)\s+${CORR_OLD}(?!\d)`,
  "iud",
);
/** REQ-755 (demo-loop cycle 5v1, M15): the wrong price FIRST — the
 *  verifier's "door trim for the gomezes is not 200, it's 275"; also "isn't
 *  $200, it's $275", "is not 200 it should be 275", es "no es 200, es 275". */
const LINE_CORRECTION_OLD_FIRST_RE = new RegExp(
  String
    .raw`^\s*(?:(?:no|oops|sorry|actually|wait|correction|perd[oó]n|en\s+realidad)[,!]?\s+)*(?<line>[^$\n.:;!?]+?)\s+(?:is\s+not|isn['’]t|was\s+not|wasn['’]t|should\s*n['’]t\s+be|no\s+es|no\s+era|no\s+cuesta)\s+${CORR_OLD}\s*,?\s*(?:(?:but|sino|pero)\s+)?(?:it['’]s|it\s+is|it\s+should\s+be|should\s+be|it['’]s\s+supposed\s+to\s+be|es|era|cuesta|debe\s+ser|deber[ií]a\s+ser)?\s+(?:actually\s+|really\s+|en\s+realidad\s+)?${CORR_MONEY}(?!\d)`,
  "iud",
);
/** REQ-755: a size, a count or a percentage after a number — "2 not 3
 *  coats", "200 sqft" — makes the sentence about that, never a price. */
const UNIT_AFTER_RE =
  /^\s*(?:%|percent|sq\.?\s*ft|sqft|sf|square|ft|feet|foot|linear|lf|in(?:ch(?:es)?)?|yards?|yds?|coats?|hours?|hrs?|days?|weeks?|months?|gallons?|gal|units?|pieces?|pcs|boxes|rolls|sheets|doors|windows|outlets|m2|metros?|pies|pulgadas|horas|d[ií]as|semanas|capas|piezas)(?!\p{L})/iu;
/** "heated floor for the hendersons" → the job's customer, at the end. */
const LINE_FOR_WHO_RE =
  /\s+(?:for|para)\s+(?:(?:the|los|las|la|el)\s+)?(?<who>[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,2})$/u;
/** Names that point at no one line ("it is $1,200 not 150", "the total"). */
const NOT_A_NAMED_LINE =
  /^(?:it|that|this|total|the\s+total|price|quote|job|estimate|eso|esto|todo|precio|cotizaci[oó]n|presupuesto|trabajo)$/i;

function wholeFracCents(whole: string, frac?: string): number {
  return Number(whole.replace(/,/g, "")) * 100 +
    (frac ? Number(frac.padEnd(2, "0")) : 0);
}

/**
 * REQ-661 (demo-loop cycle 5, M15): "heated floor for the hendersons is
 * $1,200 not 150" is a correction of a line's price — the item, who it is
 * for, its right price and the wrong one. Undefined when the words are not
 * one, or name no line ("it is $1,200 not 150").
 */
export function parseLineCorrection(
  text: string,
): LineCorrection | undefined {
  const s = text ?? "";
  const m = s.match(LINE_CORRECTION_RE) ??
    s.match(LINE_CORRECTION_OLD_FIRST_RE); // REQ-755
  const g = m?.groups;
  if (!m || !g?.line || !g.whole || !g.oldWhole) return undefined;
  // REQ-755: "the paint is 2 not 3 coats" counts coats, not dollars.
  if (
    unitFollows(s, m, "whole", "frac") ||
    unitFollows(s, m, "oldWhole", "oldFrac")
  ) return undefined;
  let line = g.line.trim();
  let customerName: string | undefined;
  const who = line.match(LINE_FOR_WHO_RE);
  if (who?.groups?.who) {
    customerName = who.groups.who.trim();
    line = line.slice(0, who.index).trim();
  }
  line = line.replace(/^(?:the|a|an|el|la|los|las|un|una)\s+/i, "").trim();
  if (!line || !/\p{L}/u.test(line) || NOT_A_NAMED_LINE.test(line)) {
    return undefined;
  }
  if (!isCleanChangeClause(line)) return undefined;
  return {
    item: line,
    ...(customerName ? { customerName } : {}),
    amountCents: wholeFracCents(g.whole, g.frac),
    previousCents: wholeFracCents(g.oldWhole, g.oldFrac),
  };
}

/** REQ-755: does a unit word ("coats", "sqft") follow the amount whose
 *  last group is `group`? The regexes carry the `d` flag for these indices. */
function unitFollows(
  s: string,
  m: RegExpMatchArray,
  ...groups: string[]
): boolean {
  const spans = groups.map((g) => m.indices?.groups?.[g]).filter((x) => !!x);
  const end = spans.at(-1)?.[1];
  return end !== undefined && UNIT_AFTER_RE.test(s.slice(end));
}

/**
 * REQ-755 (demo-loop cycle 5v1, M15): the model answered "door trim for the
 * gomezes is not 200, it's 275" with change_order "Door trim" +$75 (beside,
 * or instead of, the reprice). When the user's words correct a line's price
 * and the change order is about that line, it is that correction — the
 * line's RIGHT price — never an added line. Undefined otherwise.
 */
export function correctionForChange(
  change: { description: string },
  userText: string,
): LineCorrection | undefined {
  const c = parseLineCorrection(userText);
  if (!c || !change.description?.trim()) return undefined;
  const same = findLine([{ description: change.description }], c.item) >= 0 ||
    findLine([{ description: c.item }], change.description) >= 0;
  return same ? c : undefined;
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

  // REQ-661 (M15): "heated floor for the hendersons is $1,200 not 150" is
  // the line's right price — never "Heated floor for the hendersons is not
  // 150" added at +$1,200.
  const correction = parseLineCorrection(rest);
  if (correction) {
    if (!out.customerName && correction.customerName) {
      out.customerName = correction.customerName;
    }
    out.description = capitalize(correction.item);
    out.deltaAmountCents = correction.amountCents;
    out.setsLinePrice = true;
    return out;
  }

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
    // REQ-455 (M24): what follows the money ends at the first sentence
    // boundary — "…$40. Send it to her." is not part of the change.
    let after = rest.slice((money.index ?? 0) + money[0].length);
    const stop = after.search(/[.!?](?:\s|$)/);
    if (stop >= 0) after = after.slice(0, stop);
    rest = (rest.slice(0, money.index) + " " + after).trim();
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
    // REQ-455 (M24): only a short, well-formed item is read in code; a
    // narrative sentence is left to the model, never stored half-stripped.
    if (desc && isCleanChangeClause(desc)) out.description = capitalize(desc);
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
  /** REQ-654 (cycle 5, M10): the customer as the quote names them — the
   *  linked record's name, else its snapshot — when it has one. */
  customerName?: string;
  /** REQ-654: the quote's card title ("Kitchen remodel — Dana Whitfield");
   *  read for a name only while no customer is linked. */
  summary?: string;
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

/** REQ-654: the quote names `asked` as its customer — its customer's name
 *  or snapshot, else (no customer linked) the name on its card title. */
function boundNames(q: TargetQuote, asked: string): boolean {
  const who = boundWho(q);
  return !!who && namesCustomer(asked, who);
}

/** REQ-654: whoever the quote names as its customer, if anyone. */
function boundWho(q: TargetQuote): string | undefined {
  if (q.customerName?.trim()) return q.customerName.trim();
  if (q.customerId) return undefined;
  // "Kitchen remodel — Dana Whitfield": the part after the dash names them
  const who = (q.summary ?? "").split(/\s[—–-]\s/u).slice(1).join(" ").trim();
  return who || undefined;
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
  // REQ-654 (demo-loop cycle 5, M10): …or when it names them itself — the
  // chat's draft "Kitchen remodel — Dana Whitfield" has no customer linked
  // before the Who step, and "Change the quote: cabinets $7,000" with
  // customerName "Dana Whitfield" got "I couldn't find a quote for Dana
  // Whitfield" under the very card.
  if (bound && boundNames(bound, input.customerName)) {
    return { kind: "quote", quoteId: bound.id };
  }
  const theirs = live.filter((q) => q.customerId && matched.has(q.customerId))
    .sort(newestFirst);
  if (theirs.length === 0) {
    // REQ-654: nothing of the named customer's is on file, and the quote on
    // screen belongs to nobody yet — it is the one meant, never "none".
    return bound && !bound.customerId && !boundWho(bound)
      ? { kind: "quote", quoteId: bound.id }
      : { kind: "none" };
  }

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
// REQ-462 (demo-loop cycle 3, M26): an EXISTING change order, by its number.
// ---------------------------------------------------------------------------
//
// "Change of plan on CO-001: make it $1,000 and the description should just
// say "Upgrade to frameless glass shower door"." changes CO-001 itself.
// Nothing read "CO-001": the model called revise_quote on the signed quote
// and the reply was "…its lines can't change". The number, the new amount,
// the new wording or a withdrawal are read here; anything less certain is
// left to the model (update_change_order).

const CO_NUMBER_RE = /\bCO-\d+\b/gi;

/** Every distinct change-order number in the text, upper-cased, first
 *  spelling kept ("co-001, CO-1 and CO-002" → ["CO-001", "CO-002"]). */
export function changeOrderNumbersIn(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of (text ?? "").matchAll(CO_NUMBER_RE)) {
    const n = m[0].toUpperCase();
    if (seen.has(docNumberKey(n))) continue;
    seen.add(docNumberKey(n));
    out.push(n);
  }
  return out;
}

/** "CO-001" and "co-1" name the same order. */
export function sameDocNumber(a: string, b: string): boolean {
  return docNumberKey(a) === docNumberKey(b);
}

export interface ChangeOrderEditRequest {
  /** "CO-001", upper-cased as typed. */
  changeOrderNumber: string;
  /** The order's new wording. */
  description?: string;
  /** The order's NEW amount, integer cents — negative when the contractor
   *  said "credit"; otherwise the order keeps its direction
   *  (editedChangeOrderDelta). */
  amountCents?: number;
  withdraw?: boolean;
}

/** "a new change order", "another change order like CO-001" — not an edit. */
const NEW_CHANGE_ORDER_RE =
  /\b(?:new|another|second|separate|extra)\s+change[\s-]*orders?\b|(?<!\p{L})(?:nueva|otra)\s+[oó]rden(?:es)?\s+de\s+cambio\b/iu;
/** Advice wanted, not an instruction: "Should I make CO-001 $1,000?". */
const ADVICE_RE =
  /^\s*¿?\s*(?:should\s+(?:i|we)|do\s+you\s+think|what\s+if|would\s+it|is\s+it\s+(?:ok|okay|better)|deber[ií]a|crees\s+que)(?!\p{L})/iu;
/** A word that changes an amount — "make it", "lower … to", "cambia". */
const AMOUNT_CUE_RE =
  /\b(?:make|set|lower|raise|reduce|increase|bump|drop|cut|knock|update|adjust|fix|correct|edit|revise|put)\b|\bchange\b(?![\s-]*orders?\b)|\bshould\s+(?:be|cost)\b|\binstead\b|\bto\s+(?:-|−)?\$|(?<!\p{L})(?:cambia|cambiar|cambie|pon|ponla|ponle|deja|baja|bájala|sube|súbela|ajusta|corrige|debe\s+ser|en\s+vez|en\s+lugar)(?!\p{L})/iu;
/** The new amount is a credit. */
const CREDIT_CUE_RE =
  /\b(?:credit(?:s|ed)?|minus|refund|discount)\b|(?<!\p{L})(?:cr[eé]dito|descuento|reembolso)(?!\p{L})/iu;
/** The new amount is a charge (turns a credit into added work). */
const CHARGE_CUE_RE =
  /\b(?:charge|surcharge)\b|(?<!\p{L})(?:cargo|cobro|cobrar)(?!\p{L})/iu;
/** Words that ask for new wording. */
const DESC_CUE_RE =
  /\b(?:description|describe[ds]?|say|says|read|reads|wording|word(?:ed)?|call(?:ed)?|name[ds]?|rename|reword|retitle|title|label|text)\b|(?<!\p{L})(?:descripci[oó]n|diga|dice|ll[aá]mala|nombre|t[ií]tulo|texto)(?!\p{L})/iu;
const QUOTED_RE =
  /"([^"]{2,200})"|“([^”]{2,200})”|‘([^’]{2,200})’|(?<![\p{L}\d])'([^']{2,200})'(?![\p{L}\d])/u;
const QUOTED_ALL_RE =
  /"[^"]*"|“[^”]*”|‘[^’]*’|(?<![\p{L}\d])'[^']*'(?![\p{L}\d])/gu;
/** Unquoted new wording: "description should say X", "call it X". */
const DESC_UNQUOTED_RES = [
  /\b(?:description|wording|text)\s+(?:should\s+(?:just\s+|now\s+)?(?:say|read|be)|to|as|:|=)\s*(?:just\s+)?(.+)$/i,
  /\bshould\s+(?:just\s+|now\s+)?(?:say|read)\s+(.+)$/i,
  /\b(?:call|rename|reword|retitle|describe)\s+(?:it|this|that|CO-\d+)\s+(?:as\s+|to\s+)?(.+)$/i,
  /(?<!\p{L})que\s+diga\s+(.+)$/iu,
  /(?<!\p{L})descripci[oó]n\s*(?::|=|debe\s+decir)\s*(.+)$/iu,
];
/** Where unquoted wording ends: the next instruction, a sentence end, an amount. */
const DESC_END_RE =
  /,?\s+(?:and|y)\s+(?:make|change|set|lower|raise|bump|put|update|adjust|c[aá]mbiala|ponla|baja|sube)\b|[.;!?](?:\s|$)|\s+[—–]\s+|\s+-\s+|\s+(?:for|at|to|a|por|en)\s+(?:-|−)?\$/iu;
const WITHDRAW_VERB = String
  .raw`(?:withdraw|cancel|delete|remove|scrap|void|retract|drop|kill|pull|rescind|take\s+back|retira|retirar|cancela|cancelar|elimina|eliminar|borra|borrar|anula|anular)`;
/** Only an instruction withdraws — "Did she cancel CO-001?" never does. */
const IMPERATIVE_LEAD = String
  .raw`(?:^|[.!;:,—–-]\s*|\b(?:please|pls|so|and|then|just|now|ok|okay|go\s+ahead\s+and|(?:can|could|would|will)\s+you(?:\s+please)?)\s+|(?<!\p{L})(?:por\s+favor|y|entonces)\s+)`;
const WITHDRAW_RES = [
  new RegExp(
    String
      .raw`${IMPERATIVE_LEAD}${WITHDRAW_VERB}\s+(?:(?:the|la|el)\s+)?(?:(?:change[\s-]*order|orden\s+de\s+cambio)\s+)?CO-\d+\b(?!\s+(?:down\s+|up\s+)?(?:to|a)\s+(?:-|−)?\$)`,
    "iu",
  ),
  new RegExp(
    String
      .raw`\bCO-\d+\b[^.!?]*?${IMPERATIVE_LEAD}${WITHDRAW_VERB}\s+(?:it|this(?:\s+one)?|that(?:\s+one)?)\b`,
    "iu",
  ),
  /\bCO-\d+\b[^.!?]*?(?<!\p{L})(?:ret[ií]rala|canc[eé]lala|b[oó]rrala|elim[ií]nala|an[uú]lala)(?!\p{L})/iu,
];
const MONEY_G_RE = /(-|−)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
/** What makes an amount the OLD one: "from $1,200", "not $1,200". */
const OLD_AMOUNT_BEFORE_RE =
  /(?:\bfrom|\bnot|\binstead\s+of|\brather\s+than|\bwas|\bwere|(?<!\p{L})(?:desde|no|en\s+vez\s+de|en\s+lugar\s+de))\s*$/iu;

function withoutQuoted(text: string): string {
  return text.replace(QUOTED_ALL_RE, " ");
}

/** The new wording, if the message gives one. */
function editDescription(text: string, unquoted: string): string | undefined {
  if (!DESC_CUE_RE.test(unquoted)) return undefined;
  const q = text.match(QUOTED_RE);
  let desc = q ? (q[1] ?? q[2] ?? q[3] ?? q[4] ?? "") : "";
  if (!q) {
    for (const re of DESC_UNQUOTED_RES) {
      const m = unquoted.match(re);
      if (!m) continue;
      const end = m[1].search(DESC_END_RE);
      desc = (end >= 0 ? m[1].slice(0, end) : m[1]).trim();
      // one bare word is too thin to be sure it is wording ("should read better")
      if (desc.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length < 2) {
        desc = "";
      }
      break;
    }
  }
  desc = desc.replace(/^[\s"'“”‘’]+|[\s"'“”‘’.,;:!?]+$/g, "").trim();
  return /\p{L}{2}/u.test(desc) ? capitalize(desc) : undefined;
}

/** The new amount in cents (signed by a typed minus or "credit"), if the
 *  message gives exactly one and says to change it. */
function editAmount(unquoted: string): number | undefined {
  let corrected = false;
  const fresh: RegExpMatchArray[] = [];
  for (const m of unquoted.matchAll(MONEY_G_RE)) {
    const at = m.index ?? 0;
    const before = unquoted.slice(0, at);
    const after = unquoted.slice(at + m[0].length);
    const old = OLD_AMOUNT_BEFORE_RE.test(before) ||
      // "de $1,200 a $900"
      (/(?<!\p{L})de\s*$/iu.test(before) && /^\s+a\s+(?:-|−)?\$/i.test(after));
    if (old) corrected = true;
    else fresh.push(m);
  }
  if (fresh.length !== 1) return undefined;
  if (!corrected && !AMOUNT_CUE_RE.test(unquoted)) return undefined;
  const m = fresh[0];
  const cents = Number(m[2].replace(/,/g, "")) * 100 +
    (m[3] ? Number(m[3].padEnd(2, "0")) : 0);
  return m[1] || CREDIT_CUE_RE.test(unquoted) ? -cents : cents;
}

/**
 * Read an edit of an existing change order: exactly one CO number, and a new
 * amount (with a word that changes it), a new wording, or an instruction to
 * withdraw it. Undefined for anything else — a question, a NEW change order,
 * two numbers, nothing to change, or a withdrawal mixed with an edit — which
 * the model reads instead.
 */
export function parseChangeOrderEdit(
  text: string,
): ChangeOrderEditRequest | undefined {
  const raw = (text ?? "").trim();
  if (!raw) return undefined;
  const numbers = changeOrderNumbersIn(raw);
  if (numbers.length !== 1) return undefined;
  if (NEW_CHANGE_ORDER_RE.test(raw) || ADVICE_RE.test(raw)) return undefined;
  const unquoted = withoutQuoted(raw);
  const description = editDescription(raw, unquoted);
  const amountCents = editAmount(unquoted);
  const withdraw = WITHDRAW_RES.some((re) => re.test(unquoted));
  if (withdraw) {
    if (description !== undefined || amountCents !== undefined) {
      return undefined;
    }
    return { changeOrderNumber: numbers[0], withdraw: true };
  }
  if (description === undefined && amountCents === undefined) return undefined;
  return {
    changeOrderNumber: numbers[0],
    ...(amountCents !== undefined ? { amountCents } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

/**
 * The edited order's signed delta: the new amount keeps the order's own
 * direction — a credit stays a credit — unless the contractor said "credit"
 * (or typed a minus) or "charge". The model's sign alone never flips it.
 */
export function editedChangeOrderDelta(input: {
  currentCents: number;
  amountCents: number;
  userText?: string;
}): number {
  const abs = Math.abs(Math.round(input.amountCents));
  const said = withoutQuoted(input.userText ?? "");
  if (CREDIT_CUE_RE.test(said) || /(?:-|−)\s?\$/.test(said)) return -abs;
  if (CHARGE_CUE_RE.test(said)) return abs;
  return input.currentCents < 0 ? -abs : abs;
}

export type AmountCheck =
  | { kind: "ok"; amountCents: number }
  /** the amount fits nothing typed — ask, write nothing */
  | { kind: "ask" };

/**
 * REQ-377's guard, for an edit: the model's NEW amount for a change order
 * (unsigned) stands when it is a dollar amount the contractor typed, or the
 * order's current amount plus or minus one ("knock $200 off CO-001"). A ×10
 * / ×100 slip from exactly one of those is corrected; anything else is asked
 * about. No amount typed → nothing to check against: it stands.
 */
export function reconcileChangeOrderAmount(input: {
  amountCents: number;
  currentCents: number;
  userText: string;
}): AmountCheck {
  const amount = Math.abs(Math.round(input.amountCents));
  const typed = typedAmountsCents(input.userText);
  if (typed.length === 0) return { kind: "ok", amountCents: amount };
  const current = Math.abs(Math.round(input.currentCents));
  const fits = new Set<number>();
  for (const a of typed) {
    fits.add(a);
    fits.add(current + a);
    if (current - a > 0) fits.add(current - a);
  }
  if (fits.has(amount)) return { kind: "ok", amountCents: amount };
  const slips = new Set<number>();
  for (const scaled of [amount * 10, amount * 100, amount / 10, amount / 100]) {
    if (Number.isInteger(scaled) && fits.has(scaled)) slips.add(scaled);
  }
  if (slips.size === 1) return { kind: "ok", amountCents: [...slips][0] };
  return { kind: "ask" };
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

/** What may follow a bare amount for it to be money: the end, a pause or a
 *  joining word ("about 1200 extra.", "add 60 to her job"). */
const BARE_END = String
  .raw`(?:$|[.,;:!?)…]|(?:to|for|on|onto|and|but|so|please|pls|total)(?![\p{L}]))`;
/** "1200 extra", "1200 more", "1,200 additional", "1200 on top". */
const BARE_AFTER_RE = new RegExp(
  String.raw`^\s*(?:extra|more|additional|on top)\s*${BARE_END}`,
  "iu",
);
/** "add 1200", "plus 1200", "an additional 1,200", "another 300". */
const BARE_BEFORE_RE =
  /(?:^|[^\p{L}])(?:add(?:ing)?|plus|another|an? (?:additional|extra))\s+(?:(?:about|around|roughly|like|~)\s*)?$/iu;
const BARE_END_RE = new RegExp(String.raw`^\s*${BARE_END}`, "iu");
const BARE_NUM_RE =
  /(?<![\p{L}\d$.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d,.]?\d)/gu;

/**
 * REQ-651 (demo-loop cycle 5, B1): every amount a change order may be
 * measured against, in cents — the shared reader's amounts ("$1,200",
 * "$1.2k", "1200 dollars", "1.2k"; a rate like "$55 a foot" is not one) and
 * a bare number next to a money cue ("about 1200 extra", "1200 more", "add
 * 60 to her job", "an additional 1,200"). Pair 7's "about 1200 extra" had no
 * "$", so the model's $150 had nothing to be checked against. A size or a
 * count ("64 sqft", "add 2 more outlets") is never one.
 */
export function changeOrderAmountsCents(text: string): number[] {
  const s = text ?? "";
  const money = moneyAmounts(s);
  const out = money.filter((a) => !a.rate).map((a) => ({
    at: a.start,
    cents: a.cents,
  }));
  for (const m of s.matchAll(BARE_NUM_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (money.some((a) => start < a.end && end > a.start)) continue;
    const after = s.slice(end);
    const cued = BARE_AFTER_RE.test(after) ||
      (BARE_BEFORE_RE.test(s.slice(0, start)) &&
        (BARE_END_RE.test(after) ||
          /^\s*(?:extra|more|additional)\s*$/iu.test(after) ||
          BARE_AFTER_RE.test(after)));
    if (!cued) continue;
    const cents = centsOf(m[0]);
    if (cents > 0) out.push({ at: start, cents });
  }
  return out.sort((a, b) => a.at - b.at).map((a) => a.cents)
    .filter((c, i, all) => all.indexOf(c) === i);
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
 * typed → nothing to check against: the delta stands. The amounts are
 * `changeOrderAmountsCents`' (REQ-651: "about 1200 extra" is $1,200).
 */
export function reconcileChangeOrderDelta(input: {
  deltaCents: number;
  userText: string;
  /** The current total first, then anything else a delta may be measured from. */
  bases: number[];
}): DeltaCheck {
  const delta = Math.trunc(input.deltaCents);
  const amounts = changeOrderAmountsCents(input.userText);
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
