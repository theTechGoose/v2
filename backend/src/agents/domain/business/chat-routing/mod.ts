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
   *  job — "what should I charge for this?" — or asks for a rate. */
  job: string;
}

/** Read a pricing question ("how much do I charge for …", "what should I
 *  charge?", "¿cuánto cobro por …?"). Undefined when the message isn't one. */
export function parsePricingQuestion(
  text: string,
): PricingQuestion | undefined {
  if (!text) return undefined;
  for (const re of PRICING_RES) {
    const m = text.match(re);
    if (!m || m.index === undefined) continue;
    if (RATE_RE.test(text)) return { job: "" };
    const after = cleanJob(text.slice(m.index + m[0].length));
    if (namesAJob(after)) return { job: after };
    const before = cleanJob(text.slice(0, m.index));
    return { job: namesAJob(before) ? before : "" };
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
];

/**
 * The chat tools the model is offered this turn.
 *   - quote phase: drafting, change orders and job details always; lock and
 *     terms only while the bound quote is an open draft.
 *   - terms phase: change orders and job details only — the quote is past
 *     drafting and locking (what SYSTEM_PROMPT_TERMS always meant; pair 1's
 *     model was handed lock_quote here anyway).
 */
export function chatToolsFor(
  phase: AgentPhase,
  quote: GateQuote | undefined,
): LLMToolName[] {
  if (phase === "terms") {
    return ["change_order", "update_job_details"];
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
