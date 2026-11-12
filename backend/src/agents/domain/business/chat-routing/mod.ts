/**
 * REQ-368 (demo-loop cycle 1, M30 + M32) — the pure routing rules of one chat
 * turn, read before any chat model is asked.
 *
 *   M30: "how much do i charge for panel swap 200a" went to gpt-4o-mini with
 *   no pricing path and came back "I can't provide pricing advice…" — though
 *   the composer's own example asks "what should I charge?". A pricing
 *   question is answered by the pricing helper (SuggestPrices), not the chat.
 *
 *   M32: after the customer signed, "Please send him the deposit invoice"
 *   reached the model with EVERY tool attached; it re-locked the signed quote.
 *   A billing ask is answered from the quote's own invoices, and the model is
 *   only offered the tools the conversation's state allows.
 *
 * REQ-388 (demo-loop cycle 2, M19 + M23 + m38):
 *
 *   M23: "what should i charge to move a shower drain … in austin? explain how
 *   you got the number, and also cuánto cobro por piso radiante …?" was ONE
 *   job — the whole rest of the message. A job ends at its clause; a message
 *   can ask several prices; "explain" is read; a draft is only written when
 *   asked ("Draft a quote at $1,500").
 *   m38: "y para un baño de 5x8?" after a price is a pricing follow-up.
 *   M19: "¿Cuánto me debe Ana López?" asks what a customer owes.
 */
import type { AgentPhase } from "@agents/dto/conversation.ts";
import type { LLMToolName } from "@agents/domain/business/llm/base/mod.ts";
import { isChangeOrderRequest } from "@agents/domain/business/change-order-intent/mod.ts";

// ---------------------------------------------------------------------------
// M30 — pricing questions
// ---------------------------------------------------------------------------

/** Who the question is put to the customer for — "charge him", "bill the
 *  client" — and a trailing "for" that opens the job. */
const EN_WHOM = String
  .raw`(?:\s+(?:them|him|her|the\s+(?:customer|client|homeowner)))?`;

/** The question itself, EN then ES. The match is cut out of the message and
 *  what is left (before or after it) is the job. */
const PRICING_RES: RegExp[] = [
  new RegExp(
    String
      .raw`\bhow\s+much\s+(?:should|do|would|can|could|shall|must|will)\s+(?:i|we)\s+(?:charge|bill|ask(?:\s+for)?|quote|get(?:\s+paid)?|price(?:\s+it)?)\b${EN_WHOM}(?:\s+(?:for|to))?`,
    "i",
  ),
  new RegExp(
    String
      .raw`\bhow\s+much\s+to\s+(?:charge|bill|ask(?:\s+for)?|quote)\b${EN_WHOM}(?:\s+(?:for|to))?`,
    "i",
  ),
  new RegExp(
    String
      .raw`\bwhat\s+(?:should|do|would|can|could|shall|will)\s+(?:i|we)\s+(?:charge|bill|ask(?:\s+for)?|quote)\b${EN_WHOM}(?:\s+(?:for|to))?`,
    "i",
  ),
  /\bwhat\s+(?:price|rate)\s+(?:should|do|would|can|could)\s+(?:i|we)\s+(?:charge|give|quote|use|put|ask(?:\s+for)?)\b(?:\s+(?:for|to|on))?/i,
  /\bwhat(?:'s|’s|s|\s+is|\s+would\s+be)\s+(?:a\s+)?(?:fair|good|reasonable|typical|normal|going|right|decent|competitive)\s+(?:hourly\s+)?(?:price|rate|charge)\b(?:\s+(?:for|to|on))?/i,
  /\bhelp\s+me\s+price\b(?:\s+(?:it|this|that))?(?:\s+out)?/i,
  /\bhow\s+should\s+(?:i|we)\s+price\b(?:\s+(?:it|this|that))?/i,
  /\bprice\s+(?:it|this|that)\s+(?:out\s+)?for\s+me\b/i,
  /(?<!\p{L})cu[aá]nto\s+(?:le\s+|les\s+)?(?:deber[ií]a\s+|debo\s+|puedo\s+|podr[ií]a\s+|tengo\s+que\s+)?(?:le\s+|les\s+)?cobr(?:o|ar|arle|arles|ar[ií]a|amos)(?!\p{L})(?:\s+(?:por|para))?/iu,
  /(?<!\p{L})qu[eé]\s+precio\s+(?:le\s+|les\s+)?(?:pongo|cobro|doy|pondr[ií]a|deber[ií]a\s+(?:cobrar|poner|dar))(?!\p{L})(?:\s+(?:a|al|por|para))?/iu,
  /(?<!\p{L})ay[uú]dame\s+a\s+(?:ponerle\s+|poner\s+|calcular\s+|sacar\s+)?(?:el\s+|un\s+)?precio(?!\p{L})(?:\s+(?:a|al|de|para))?/iu,
];

/** "per hour", "hourly", "por hora" — a rate, not a job to price. */
const RATE_RE =
  /\b(?:per|an|a|by\s+the)\s+(?:hour|hr|day|sq\.?\s*ft|sqft|square\s+(?:foot|feet|ft)|linear\s+(?:foot|feet|ft)|foot|ft)\b|\bhourly\b|(?<!\p{L})(?:por|la)\s+(?:hora|d[ií]a|pie|metro)(?!\p{L})/iu;

/** Lead-ins that are not the job: "customer wants a …", "el cliente quiere
 *  una …" (kept: the article after them), and the starter chip's
 *  "I know the job" / "Conozco el trabajo". */
const LEAD_IN_RE =
  /^(?:(?:my|the|this|a)\s+)?(?:customer|client|homeowner|guy|lady|she|he|they)\s+(?:wants?|needs?|asked\s+for|is\s+asking\s+for|would\s+like)\s+|^(?:(?:el|la|mi)\s+)?(?:cliente|clienta|señora|señor|due[ñn]o)\s+(?:quiere|necesita|pide)\s+|^(?:i|we)\s+know\s+the\s+job\b|^conozco\s+el\s+trabajo(?!\p{L})/iu;

/** Words that, alone, name no job ("this", "the job", "it"). */
const NO_JOB = new Set([
  "this",
  "that",
  "it",
  "its",
  "job",
  "the",
  "one",
  "work",
  "these",
  "those",
  "them",
  "him",
  "her",
  "me",
  "us",
  "you",
  "for",
  "and",
  "please",
  "pls",
  "customer",
  "client",
  "quote",
  "price",
  "esto",
  "eso",
  "este",
  "ese",
  "esta",
  "esa",
  "trabajo",
  "uno",
  "una",
  "por",
  "para",
  "que",
  "precio",
  "cliente",
]);

function cleanJob(raw: string): string {
  let s = raw
    .replace(/[¿?¡!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s,.;:—–-]+|[\s,.;:—–-]+$/g, "")
    .trim();
  s = s.replace(LEAD_IN_RE, "").trim();
  s = s.replace(/^(?:for|on|to|por|para)\s+/i, "").trim();
  s = s.replace(
    /\s+(?:for|por)\s+(?:it|this|that|this\s+job|that\s+job|esto|eso|este\s+trabajo)$/i,
    "",
  ).trim();
  return s.replace(/^[\s,.;:—–-]+|[\s,.;:—–-]+$/g, "").trim();
}

function namesAJob(s: string): boolean {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .some((w) => /\d/.test(w) || (w.length >= 3 && !NO_JOB.has(w)));
}

export interface PricingQuestion {
  /** The job to price as the contractor wrote it, minus the question
   *  ("panel swap 200a", "a 10'x10' slab"). Empty when the message names no
   *  job — "what should I charge for this?" — or asks for a rate. REQ-388:
   *  the FIRST job the message asks about, up to the end of its clause. */
  job: string;
}

/** REQ-388 (M23): one job a pricing question asks a price for. */
export interface PricingSubject {
  /** The contractor's words for the job, up to the end of its clause. */
  job: string;
  /** Asked "…charge TO move a drain" — the job is an action ("to move a
   *  shower drain"), not a thing ("for a panel swap"). */
  action: boolean;
}

/** REQ-388 (M23): where the job a pricing question names ends — the end of
 *  its sentence ("?", "!", ";", "…", "...", ". Next"), "and also …", or an
 *  ask to explain ("explain how you got the number", "and why", "¿por
 *  qué?"). A comma alone, "sq. ft" and "$1,500.50" are not boundaries. */
const CLAUSE_END_RES: RegExp[] = [
  /[?!;]|\.{2,}|…|\.(?=\s+[A-Z¿¡])/u,
  /,?\s+(?:and\s+|y\s+|e\s+|plus\s+|then\s+|but\s+|pero\s+)?(?:also|tambi[eé]n|adem[aá]s)(?!\p{L})/iu,
  /,?\s+(?:and\s+|y\s+|then\s+|but\s+|pero\s+|so\s+)?(?:please\s+|por\s+favor\s+|can\s+you\s+|could\s+you\s+|puedes\s+)?(?:explain|expl[ií]ca(?:me|lo|nos)?|tell\s+me|dime|show\s+me|mu[eé]strame|walk\s+me|break\s+(?:it|that|this)\s+down|why|por\s*qu[eé]|how\s+(?:did|do|would)\s+you|c[oó]mo\s+(?:lo\s+)?(?:calculaste|sacaste|llegaste|calculas))(?!\p{L})/iu,
];

/** REQ-579 (cycle 4, M14): a '.' after one of these ends no sentence —
 *  "(sod St. Augustine)" titled pair 2's quote "Poner césped nuevo (sod St". */
const ABBREV_BEFORE_DOT_RE =
  /(?<!\p{L})(?:st|dr|ave|mt|mr|mrs|ms|jr|sr|sra|dra|no|approx|aprox|apt|blvd|rd|ln|ft|sq|av)$/iu;

/** Open "(" / "[" before `at` that are not yet closed. */
function openParens(s: string, at: number): number {
  let depth = 0;
  for (let i = 0; i < at; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
  }
  return depth;
}

/** The text up to its first clause boundary. REQ-579: never inside open
 *  parentheses, and never at the '.' of an abbreviation ("St.", "Dr."). */
function clipClause(s: string): string {
  let end = s.length;
  for (const re of CLAUSE_END_RES) {
    const all = new RegExp(
      re.source,
      re.flags.includes("g") ? re.flags : `${re.flags}g`,
    );
    for (const m of s.matchAll(all)) {
      const at = m.index ?? 0;
      if (at >= end) break;
      if (m[0] === "." && ABBREV_BEFORE_DOT_RE.test(s.slice(0, at))) continue;
      if (openParens(s, at) > 0) continue;
      end = at;
      break;
    }
  }
  return s.slice(0, end);
}

/** The clause that ends where the question starts ("Thanks. Customer wants a
 *  slab, " → "Customer wants a slab"); empty when a sentence just ended. */
function lastClause(before: string): string {
  const s = before.replace(/[\s,¿¡:—–-]+$/u, "");
  if (/[.?!;…]$/.test(s)) return "";
  let cut = 0;
  for (const m of s.matchAll(/[?!;¿¡…]|\.(?=\s+[A-Z¿¡])/gu)) {
    cut = (m.index ?? 0) + m[0].length;
  }
  return s.slice(cut);
}

interface PricingMatch {
  index: number;
  end: number;
  /** the question ended in "to" ("what should I charge to …") */
  to: boolean;
}

/** Every pricing question in the message, in order, never overlapping. */
function pricingMatches(text: string): PricingMatch[] {
  const found: PricingMatch[] = [];
  for (const re of PRICING_RES) {
    const all = new RegExp(re.source, `${re.flags}g`);
    for (const m of text.matchAll(all)) {
      const index = m.index ?? 0;
      found.push({
        index,
        end: index + m[0].length,
        to: /\sto$/i.test(m[0]),
      });
    }
  }
  found.sort((a, b) => a.index - b.index || b.end - a.end);
  const out: PricingMatch[] = [];
  for (const m of found) {
    if (out.length === 0 || m.index >= out[out.length - 1].end) out.push(m);
  }
  return out;
}

/** The job each question asks about: the words after it up to the end of
 *  their clause (or the next question); for the first question only, else
 *  the clause before it ("Customer wants a 10'x10' slab, what should I
 *  charge?"). Questions that name no job are left out. */
function subjectsOf(text: string, ms: PricingMatch[]): PricingSubject[] {
  const out: PricingSubject[] = [];
  ms.forEach((m, i) => {
    const next = ms[i + 1]?.index ?? text.length;
    let job = cleanJob(clipClause(text.slice(m.end, next)));
    let action = m.to;
    if (!namesAJob(job) && i === 0) {
      job = cleanJob(lastClause(text.slice(0, m.index)));
      action = false;
    }
    if (namesAJob(job)) out.push({ job, action });
  });
  return out;
}

/** Read a pricing question ("how much do I charge for …", "what should I
 *  charge?", "¿cuánto cobro por …?"). Undefined when the message isn't one. */
export function parsePricingQuestion(
  text: string,
): PricingQuestion | undefined {
  if (!text) return undefined;
  const ms = pricingMatches(text);
  if (ms.length === 0) return undefined;
  if (RATE_RE.test(text)) return { job: "" };
  return { job: subjectsOf(text, ms)[0]?.job ?? "" };
}

/** REQ-388 (M23): every job the message asks a price for, in order — pair 7
 *  asked two (the drain move, in English, and the heated floor, in Spanish).
 *  Empty when it is not a pricing question, names no job, or asks a rate. */
export function pricingSubjects(text: string): PricingSubject[] {
  if (!text) return [];
  const ms = pricingMatches(text);
  if (ms.length === 0 || RATE_RE.test(text)) return [];
  return subjectsOf(text, ms);
}

/** REQ-388 (M23): the message also asks how the price was reached —
 *  "explain how you got the number", "and why", "¿por qué?", "explícame". */
const HOW_PRICED_RE =
  /(?<!\p{L})(?:explain|explanation|why|walk\s+me\s+through|break\s+(?:it|that|this)\s+down|show\s+(?:me\s+)?(?:the|your)\s+math|how\s+(?:did|do|would)\s+you\s+(?:get|come\s+up|figure|calculate|arrive|land)|expl[ií]ca(?:me|lo|nos|r)?|explicaci[oó]n|por\s*qu[eé]|c[oó]mo\s+(?:lo\s+)?(?:calculaste|sacaste|llegaste|calculas))(?!\p{L})/iu;

export function asksHowPriced(text: string): boolean {
  return !!text && HOW_PRICED_RE.test(text);
}

/** REQ-388 (m38): "y para un baño de 5x8?", "and for a 5x8 one?", "what
 *  about a 12x12 room?" — the same price, for another size or variant. Read
 *  only right after a pricing answer (the caller's check). */
const FOLLOW_UP_RE =
  /^\s*[¿¡]?\s*(?:(?:y|and|e)\s+(?:(?:qu[eé]\s+tal|what\s+about|how\s+about)\s+|(?:para|por|for|with|con|en|in)\s+|(?:si\s+es|if\s+it'?s|if\s+its)\s+(?:de\s+|of\s+)?)|(?:qu[eé]\s+tal|what\s+about|how\s+about)\s+(?:(?:para|por|con|en|si\s+es)\s+(?:de\s+)?)?)(.+?)[\s?¡!.]*$/iu;
/** …but not a new question ("y para cuándo?"), nor a language ("and in
 *  Spanish?"). */
const FOLLOW_UP_NOT_RE =
  /^(?:cu[aá]nd[oa]|cu[aá]nt[oa]s?|qu[eé]|c[oó]mo|d[oó]nde|por\s*qu[eé]|qui[eé]n|when|how|what|where|why|who|the\s+total|el\s+total)(?!\p{L})|^(?:spanish|english|espa[nñ]ol|ingl[eé]s)$/iu;

export function parsePricingFollowUp(
  text: string,
): { job: string } | undefined {
  const m = text?.match(FOLLOW_UP_RE);
  if (!m) return undefined;
  const rest = m[1].trim();
  if (FOLLOW_UP_NOT_RE.test(rest) || rest.split(/\s+/).length > 10) {
    return undefined;
  }
  const job = cleanJob(rest);
  return namesAJob(job) ? { job } : undefined;
}

/** REQ-388 (M23): "move a shower drain … in austin" priced for Austin, TX —
 *  the place is where the job is, not the job (the reply already says it). */
export function withoutPlace(
  job: string,
  place: { city?: string; state?: string },
): string {
  const city = place.city?.trim();
  if (!city) return job;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const state = place.state?.trim();
  const re = new RegExp(
    `\\s+(?:in|en)\\s+${esc(city)}(?:,?\\s+${
      state ? esc(state) : "[a-z]{2}"
    })?\\s*$`,
    "i",
  );
  return job.replace(re, "").trim() || job;
}

/** REQ-388 (M23): "Draft a quote at $1,500" — the words the chat's offer
 *  button sends (asstChat.draftOffer) — "draft it", "draft it at 1800",
 *  "Preparar cotización por $1,500", "sí, prepárala". A sentence with a job
 *  in it ("draft a quote for a deck, $3,000") is not one. */
const DRAFT_AMOUNT = String
  .raw`(?:\s+(?:at|for|por|a|en)\s+\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?)?`;
const DRAFT_RES: RegExp[] = [
  new RegExp(
    String
      .raw`^\s*(?:(?:yes|yeah|yep|sure|ok(?:ay)?)[,!.]?\s+)?(?:please\s+)?draft\s+(?:it|that|one|the\s+quote|a\s+quote|me\s+a\s+quote)${DRAFT_AMOUNT}(?:\s+please)?[\s.!]*$`,
    "i",
  ),
  new RegExp(
    String
      .raw`^\s*(?:(?:s[ií]|ok|vale|dale|claro)[,!.]?\s+)?(?:por\s+favor\s+)?(?:prepar(?:a|ar|e)\s+(?:la\s+|una\s+)?cotizaci[oó]n|prep[aá]rala|prep[aá]ramela)${DRAFT_AMOUNT}(?:\s+por\s+favor)?[\s.!]*$`,
    "iu",
  ),
];

export function parseDraftRequest(
  text: string,
): { amountCents?: number } | undefined {
  if (!text) return undefined;
  for (const re of DRAFT_RES) {
    const m = text.match(re);
    if (!m) continue;
    if (!m[1]) return {};
    const whole = Number(m[1].replace(/,/g, ""));
    const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
    const cents = whole * 100 + frac;
    return cents > 0 ? { amountCents: cents } : {};
  }
  return undefined;
}

/** The quote title for a priced job: no leading article, first letter up
 *  ("a 10'x10' slab" → "10'x10' slab", "panel swap 200a" → "Panel swap 200a"). */
export function jobTitle(job: string): string {
  const s = job.trim().replace(/^(?:a|an|the|un|una|el|la|los|las)\s+/i, "");
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// M32 — billing asks
// ---------------------------------------------------------------------------

const INVOICE_RE = new RegExp(
  [
    String.raw`\binvoic(?:e|es|ed|ing)\b`,
    String
      .raw`\bbill\s+(?:him|her|them|it|the\s+(?:customer|client|deposit|balance)|for\s+(?:the\s+)?(?:deposit|balance|job|work))\b`,
    String
      .raw`\b(?:collect|charge|request)\s+(?:(?:him|her|them)\s+)?(?:for\s+)?(?:the\s+)?(?:deposit|down\s*payment|balance)\b`,
    String
      .raw`\bsend\s+(?:him|her|them|the\s+(?:customer|client))\s+(?:the\s+|a\s+|his\s+|her\s+|their\s+)?(?:bill|deposit)\b`,
    String
      .raw`(?<!\p{L})fact[uú]r(?:a|as|ar|arle|arles|ale|ales|e|en|o|amos|ando|ado|ada)(?!\p{L})`,
    String
      .raw`(?<!\p{L})c[oó]bra(?:le|les|r|rle|rles)\s+(?:el|la|los|las)\s+(?:dep[oó]sito|anticipo|adelanto|enganche|saldo|resto)(?!\p{L})`,
  ].join("|"),
  "iu",
);

/** "send him the deposit invoice", "bill the customer", "mándale la
 *  factura" — a request about billing the conversation's job. A change order
 *  that mentions the invoice is not one (it changes the job; REQ-238). */
export function isInvoiceRequest(text: string): boolean {
  if (!text || isChangeOrderRequest(text)) return false;
  return INVOICE_RE.test(text);
}

// ---------------------------------------------------------------------------
// REQ-388 (M19) — "what does <customer> owe?"
// ---------------------------------------------------------------------------

/** The name sits between the words ("how much does John Miller owe me"). */
const OWED_BETWEEN_RES: RegExp[] = [
  /\b(?:how\s+much|what)\s+(?:money\s+)?(?:does|do|did)\s+(.+?)\s+(?:still\s+|currently\s+)?owe\b/i,
  /\b(?:how\s+much|what)\s+(?:is|are)\s+(.+?)\s+(?:still\s+)?owing\b/i,
  /\bwhat(?:'s|’s|\s+is)\s+(.+?)(?:'s|’s)\s+(?:balance|tab)\b/i,
  /\bwhen\s+(?:will|is|does|do|did|can|are)\s+(.+?)\s+(?:going\s+to\s+|gonna\s+)?pay\b/i,
  /\bdoes\s+(.+?)\s+(?:still\s+)?owe\s+(?:me|us)\b/i,
];
/** The name follows (or precedes) the words ("¿Cuánto me debe Ana López?",
 *  "¿Ana López cuánto me debe?", "¿Cuándo me paga Ana?"). Never "¿cuánto le
 *  debo a…?" — that is what the contractor owes. */
const OWED_AROUND_RES: RegExp[] = [
  // "me"/"nos" is what makes it a debt: "¿qué debe incluir…?" and "¿cuánto
  // debe costar…?" are not about anyone owing.
  /(?<!\p{L})(?:cu[aá]nto|qu[eé])\s+(?:dinero\s+)?(?:me|nos)\s+(?:debe|deben|adeuda|adeudan)(?!\p{L})/iu,
  /(?<!\p{L})cu[aá]ndo\s+(?:me|nos)\s+(?:va\s+a\s+pagar|van\s+a\s+pagar|paga|pagan|pagar[aá]n?)(?!\p{L})/iu,
];
/** Where a name after the question ends. */
const NAME_END_RE =
  /[?.!,;:¿¡]|\s+(?:y|e|o|and|or|pero|but|cuando|cu[aá]ndo|when|desde|since|hasta|until|por|para|for|en|on|todav[ií]a|still|ya|already|ahora|now|hoy|today|me|us)(?!\p{L})/iu;
const NAME_LEAD_RE =
  /^(?:(?:todav[ií]a|a[uú]n|ya|still|actually|really|en\s+total|in\s+total)\s+)+/iu;
/** "the customer", "la señora", "my client" in front of (or as) the name. */
const NAME_TITLE_RE =
  /^(?:(?:the|my|our|el|la|los|las|mi|mis|nuestro|nuestra)\s+)?(?:(?:customer|client[ea]?|homeowner|se[ñn]ora?|se[ñn]orita|sra?\.?|srta\.?|don|do[ñn]a|mr\.?|mrs\.?|ms\.?|miss)(?:\s+|$))?/iu;
const SELF_RE = /^(?:i|we|yo|nosotros|nosotras)$/i;
const SOMEONE_RE =
  /^(?:he|she|they|him|her|them|it|this|that|él|el|ella|ellos|ellas|usted|ustedes|este|esta|ese|esa|esto|eso|alguien|someone|anyone|(?:the\s+|this\s+|el\s+|la\s+|este\s+|esta\s+)?(?:job|quote|invoice|project|account|deposit|trabajo|cotizaci[oó]n|factura|proyecto|cuenta|dep[oó]sito|anticipo))$/iu;

/** The words right before the question, with nothing in between ("¿Ana
 *  López cuánto me debe?" → "Ana López"); never across a comma or the
 *  question's own "¿" ("Bueno, ¿cuánto me debe?" names nobody). */
function nameRightBefore(before: string): string {
  const s = before.trimEnd();
  if (!s || /[,.;:?!¿¡…]$/.test(s)) return "";
  const cut = Math.max(
    ...[",", ".", ";", ":", "?", "!", "¿", "¡", "…"].map((c) =>
      s.lastIndexOf(c)
    ),
  );
  return s.slice(cut + 1);
}

/** null: the contractor is the one owing ("how much do I owe …") — not this
 *  question. "": nobody named. Otherwise the name. */
function owedName(raw: string): string | null {
  const s = raw.replace(NAME_LEAD_RE, "").trim()
    .replace(/^[\s,¿¡]+|[\s,.?!¿¡]+$/gu, "");
  if (SELF_RE.test(s)) return null;
  const name = s.replace(NAME_TITLE_RE, "").trim();
  if (!name || SOMEONE_RE.test(name)) return "";
  const words = name.split(/\s+/);
  if (words.length > 4 || /\d/.test(name)) return "";
  return name;
}

export interface OwedQuestion {
  /** The customer named ("Ana López"); absent when nobody is ("¿cuánto me
   *  debe?", "what does the customer owe?") — the caller then uses the
   *  conversation's customer or the one the thread last asked about. */
  customerName?: string;
}

/** REQ-388 (M19): "¿Cuánto me debe Ana López?", "how much does John Miller
 *  owe me?", "when is Ana going to pay me?". Undefined when the message is
 *  not about what a customer owes. */
export function parseOwedQuestion(text: string): OwedQuestion | undefined {
  if (!text) return undefined;
  for (const re of OWED_BETWEEN_RES) {
    const m = text.match(re);
    if (!m) continue;
    const name = owedName(m[1]);
    if (name === null) return undefined;
    return name ? { customerName: name } : {};
  }
  for (const re of OWED_AROUND_RES) {
    const m = text.match(re);
    if (!m || m.index === undefined) continue;
    const rest = text.slice(m.index + m[0].length);
    const cut = rest.match(NAME_END_RE);
    let name = owedName(
      cut?.index !== undefined ? rest.slice(0, cut.index) : rest,
    );
    if (!name) name = owedName(nameRightBefore(text.slice(0, m.index)));
    if (name === null) return undefined;
    return name ? { customerName: name } : {};
  }
  return undefined;
}

/** REQ-388 (M19): pair 2's follow-up "¿Cuánto dinero me debe y cuándo me va
 *  a pagar?" names nobody — it is about the customer the thread last asked
 *  about ("¿Cuánto me debe Ana López?"). Newest message first. */
export function owedNameFromHistory(texts: string[]): string | undefined {
  for (let i = texts.length - 1; i >= 0; i--) {
    const name = parseOwedQuestion(texts[i])?.customerName;
    if (name) return name;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// M32 — which tools the model may call
// ---------------------------------------------------------------------------

/** The bound quote, as far as the gate needs it. */
export interface GateQuote {
  status?: string | null;
  sentAt?: string | null;
  lockedAt?: string | null;
}

/** A draft not yet sent — the only quote that can still be locked and taken
 *  into the terms wizard. Locked drafts are still drafts. */
export function isOpenDraft(quote: GateQuote): boolean {
  return (quote.status ?? "draft").toLowerCase() === "draft" && !quote.sentAt;
}

const ALL_TOOLS: readonly LLMToolName[] = [
  "create_quote",
  "lock_quote",
  "request_terms_transition",
  "change_order",
  "update_job_details",
  // REQ-375 (demo-loop cycle 2, M11 + B1): both prompts tell the model to
  // reprice / reword a line with revise_quote; it was never offered.
  "revise_quote",
  // REQ-462 (demo-loop cycle 3, M26): edit / withdraw a change order by number.
  "update_change_order",
];

/**
 * The chat tools the model is offered this turn.
 *   - quote phase: drafting, change orders and job details always; lock and
 *     terms only while the bound quote is an open draft.
 *   - terms phase: line revisions, change orders and job details only — the
 *     quote is past drafting and locking (what SYSTEM_PROMPT_TERMS always
 *     meant; pair 1's model was handed lock_quote here anyway). A sent
 *     quote's price changes go through revise_quote as its next Version
 *     (REQ-375) — there is no Re-open on a sent quote.
 */
export function chatToolsFor(
  phase: AgentPhase,
  quote: GateQuote | undefined,
): LLMToolName[] {
  if (phase === "terms") {
    return [
      "revise_quote",
      "change_order",
      "update_job_details",
      "update_change_order", // REQ-462
    ];
  }
  const advance = !!quote && isOpenDraft(quote);
  return ALL_TOOLS.filter((t) =>
    advance || (t !== "lock_quote" && t !== "request_terms_transition")
  );
}

/**
 * May a lock_quote / request_terms_transition action run? Only on an open
 * draft in the quote phase. `undefined` = the bound quote could not be read
 * (or none is bound): the quote phase keeps its old path for it.
 */
export function mayAdvanceQuote(
  phase: AgentPhase,
  quote: GateQuote | undefined,
): boolean {
  return phase === "quote" && (quote === undefined || isOpenDraft(quote));
}
