/**
 * Onboarding parsing helpers.
 *
 * When `user.name` is null on the first turn of a conversation, Bossie
 * asks for the user's name + business. The user's reply might be:
 *
 *   - "Diego"                                 → name="Diego"
 *   - "Diego Martinez"                        → name="Diego Martinez"
 *   - "It's Diego, Riley Roofing Co."         → name="Diego", biz="Riley Roofing Co."
 *   - "Diego from Riley Roofing"              → name="Diego", biz="Riley Roofing"
 *   - "name's Tom, Tom & Linda's Painting"    → name="Tom", biz="Tom & Linda's Painting"
 *   - "skip" / "later" / "not now"            → skip
 *   - "Quote a fence for the Patels — $350"   → no extraction (real request)
 *
 * The heuristic must err on the side of NOT extracting — false positives
 * lock in a bogus name. Quote-like content (numbers, dollar signs, "for
 * the X") is treated as a real request, not a name reply, even if it
 * also contains a capitalised word.
 */

import { type Lang, t } from "@core/i18n/mod.ts";
import {
  matchesConfirmIntent,
  matchesSkipIntent,
} from "#quote-flow/intent-parsers.ts";
import {
  AREA_CODE_STATE,
  areaCodeFromPhone,
  stateFromPhone,
  US_STATES,
} from "@core/business/us-states/mod.ts";

// US state data + phone→state helpers were hoisted to a shared core module
// so the users/profile side can reuse them without importing the agents
// module. Re-exported from this path so every existing import keeps working.
export { AREA_CODE_STATE, areaCodeFromPhone, stateFromPhone, US_STATES };

const PREFIX_RE =
  /^(?:i'?m|i\s+am|it'?s|name'?s|name\s+is|this\s+is|call\s+me|hi[, ]+i'?m|hey[, ]+i'?m)\s+/i;
const SEPARATOR_RE = /(?:,|\s+(?:from|at|of|with|—|-|–))\s+/i;
const QUOTE_SIGNAL_RE =
  /(\$\s*\d|\b\d+\s*(?:sqft|sq\.?\s*ft|sq|hours?|hrs?|days?|gal|panels?|pieces?|units?|ft)\b|\bquote\b|\binvoice\b|\bnudge\b|\bfollow\s*up\b|\bdraft\b|\bestimate\b|\bbid\b)/i;
// Skip vocabulary lives in the shared bilingual intent parser
// (#quote-flow/intent-parsers.ts — EN mirrors the old SKIP_RE; ES adds the
// words the ES UI itself advertises: omitir · más tarde · luego · ahora no ·
// saltar). P-04: "omitir" must be accepted, not looped.
/**
 * Words that look name-shaped (capitalised, single token) but obviously
 * aren't names. The extractor would otherwise greedily lock these in.
 */
const STOP_WORDS = new Set([
  "hey",
  "hi",
  "hello",
  "hola",
  "yo",
  "sup",
  "ok",
  "okay",
  "k",
  "kk",
  "morning",
  "afternoon",
  "evening",
  "good",
  "thanks",
  "thank",
  "ty",
  "yes",
  "yeah",
  "yep",
  "yup",
  "no",
  "nope",
  "sure",
  "test",
  "testing",
  "help",
  "wait",
  "hmm",
  "uhh",
  "uh",
  "um",
  "umm",
]);

export interface OnboardingExtraction {
  name?: string;
  businessName?: string;
}

export function isSkipReply(text: string): boolean {
  if (!text) return false;
  return matchesSkipIntent(text);
}

/**
 * Heuristic for "this message is clearly a real job request, not a
 * reply to the onboarding prompt." Used to drop the ask out of the way
 * when the user types past it.
 *
 * Triggers on any of:
 *   - dollar signs / quote-shop vocabulary (handled by QUOTE_SIGNAL_RE)
 *   - 5+ words (onboarding replies are typically 1–4 words; anything
 *     longer is likely a real request)
 *   - construction trade vocabulary (door, roof, fence, etc.)
 */
const TRADE_RE =
  /\b(?:fence|deck|roof(?:ing)?|gutter|paint(?:ing)?|epoxy|floor(?:ing)?|garage|kitchen|bath(?:room)?|patio|driveway|tile|plumb(?:ing)?|electric(?:al|ian)?|hvac|window|door|siding|drywall|insulat(?:e|ion)|landscap(?:e|ing)|concrete|carpentr?y|repair|install(?:ation)?|remodel|renovat(?:e|ion)|backsplash|shingle|stucco|trim)\b/i;
export function looksLikeJobRequest(text: string): boolean {
  if (!text) return false;
  if (QUOTE_SIGNAL_RE.test(text)) return true;
  if (TRADE_RE.test(text)) return true;
  if (text.split(/\s+/).filter(Boolean).length >= 5) return true;
  return false;
}

/**
 * Try to extract `{name, businessName}` from a chat message. Returns
 * `undefined` when the input doesn't read as an onboarding-style reply
 * (e.g. it looks like an actual job request, has too many words, etc.).
 *
 * Rules of thumb:
 *   - If the input contains a quote signal (dollars, units, "quote",
 *     "invoice", etc.), bail — it's a job request.
 *   - If the input is longer than ~80 chars OR has more than 12 words,
 *     bail — onboarding replies are short.
 *   - Strip leading "I'm/it's/name's/call me" prefixes.
 *   - Split on "from / at / of / with / , / —" to separate name from biz.
 */
export function extractNameAndBusiness(
  input: string,
): OnboardingExtraction | undefined {
  if (!input) return undefined;
  // Strip a single trailing `!` or `?`, but keep trailing `.` so
  // abbreviated business suffixes ("Co.", "Inc.", "LLC.") survive.
  const trimmed = input.trim().replace(/[!?]+$/, "");
  if (trimmed.length === 0 || trimmed.length > 80) return undefined;
  if (QUOTE_SIGNAL_RE.test(trimmed)) return undefined;

  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 12) return undefined;

  // Strip optional "I'm / it's / call me" intros.
  const stripped = trimmed.replace(PREFIX_RE, "").trim();
  if (!stripped) return undefined;

  // Split on the first natural separator. Otherwise the whole string
  // is the name (single token or two tokens like "Diego Martinez").
  const sepMatch = stripped.match(SEPARATOR_RE);
  let namePart: string;
  let bizPart: string | undefined;
  if (sepMatch && sepMatch.index !== undefined) {
    namePart = stripped.slice(0, sepMatch.index).trim();
    bizPart = stripped.slice(sepMatch.index + sepMatch[0].length).trim();
  } else {
    namePart = stripped;
  }

  // Name validation: 1–4 tokens, each starting with a letter, no digits.
  // Allows "Diego", "Diego Martinez", "Tom & Linda K." (we keep the &/.).
  const nameWords = namePart.split(/\s+/).filter(Boolean);
  if (nameWords.length === 0 || nameWords.length > 4) return undefined;
  if (/\d/.test(namePart)) return undefined;
  if (!/^[A-Za-z]/.test(nameWords[0])) return undefined;
  // Single-token replies that match a stoplist word ("Hey", "ok",
  // "thanks") aren't names — bail. Multi-token names are fine.
  if (nameWords.length === 1 && STOP_WORDS.has(nameWords[0].toLowerCase())) {
    return undefined;
  }

  // Title-case single-token lowercase names ("diego" → "Diego"). Leave
  // multi-word names alone — the user likely typed them with their own
  // casing intent.
  const name =
    nameWords.length === 1 && nameWords[0] === nameWords[0].toLowerCase()
      ? nameWords[0][0].toUpperCase() + nameWords[0].slice(1)
      : namePart;

  // Business validation: same digit-free rule, max ~50 chars.
  let businessName: string | undefined;
  if (bizPart && bizPart.length > 0 && bizPart.length <= 50) {
    businessName = bizPart;
  }

  return businessName ? { name, businessName } : { name };
}

/** First-message Bossie ask. Kept short on purpose — phone-friendly. */
export const ONBOARDING_ASK_TEXT = t("en", "onboarding.askNameAndBusiness");

/** Single-question onboarding asks — used when we know exactly which
 *  field is missing and want to keep the conversation feeling like a
 *  one-thing-at-a-time chat instead of a form. */
export const ONBOARD_ASK_NAME = t("en", "onboarding.askName");
export const ONBOARD_ASK_BUSINESS = (
  firstName: string,
  lang: Lang = "en",
): string => t(lang, "onboarding.askBusiness", { firstName });
export const ONBOARD_ASK_STATE = (
  firstName: string,
  lang: Lang = "en",
): string => t(lang, "onboarding.askState", { firstName });
export const ONBOARD_ASK_ADDRESS = (
  firstName: string,
  lang: Lang = "en",
): string => t(lang, "onboarding.askAddress", { firstName });
export const ONBOARD_HANDOFF = (firstName: string, lang: Lang = "en"): string =>
  t(lang, "onboarding.handoff", { firstName });
/** Combined email + payment-method ask. Single question on purpose so
 *  the user types one quick line and we extract whichever pieces they
 *  give us (email regex; payment handle keyword-match). Both are nice
 *  to have but not blocking — "skip" jumps to the handoff. */
export const ONBOARD_ASK_PAYOUT = (
  firstName: string,
  lang: Lang = "en",
): string => t(lang, "onboarding.askPayout", { firstName });

/**
 * Language-robust detection of which onboarding question a prior assistant
 * message was. The single-question flow needs to know "did I just ask for
 * the business name?" to decide whether the user's next reply is an answer
 * to parse or a fresh prompt to (re)issue.
 *
 * The detection used to string-match English prose ("Nice to meet you,"),
 * which silently misrouted replies the moment the asks were localized — a
 * Spanish "¡Mucho gusto," matches none of those. Instead we match the prior
 * text against the stable leading literal of each ask template (the part
 * before the first `{placeholder}`) in BOTH languages, derived from the
 * shared lang files so it can't drift out of sync.
 */
type AskCategory =
  | "name"
  | "business"
  | "state"
  | "stateGuess"
  | "address"
  | "payout";

// Inclusion sets mirror the original (English-only) detection exactly, just
// computed for en+es: name → askName + legacy askNameAndBusiness; address →
// the ask AND its parse-error reprompt (the only reprompt the old code
// treated as "just asked").
const ASK_CATEGORY_KEYS: Record<AskCategory, string[]> = {
  name: ["onboarding.askName", "onboarding.askNameAndBusiness"],
  business: ["onboarding.askBusiness"],
  state: ["onboarding.askState", "onboarding.askStateGuess"],
  stateGuess: ["onboarding.askStateGuess"],
  address: ["onboarding.askAddress", "onboardingChat.address.reprompt"],
  payout: ["onboarding.askPayout"],
};

/** Leading literal of an ask template (everything before the first
 *  `{placeholder}`), trimmed. `t()` with no vars leaves placeholders intact. */
function askPrefix(lang: Lang, key: string): string {
  return t(lang, key).split("{")[0].trim();
}

const ASK_PREFIXES: Record<AskCategory, string[]> = Object.fromEntries(
  (Object.entries(ASK_CATEGORY_KEYS) as [AskCategory, string[]][]).map((
    [cat, keys],
  ) => [
    cat,
    keys
      .flatMap((k) => (["en", "es"] as Lang[]).map((l) => askPrefix(l, k)))
      .filter((p) => p.length > 0),
  ]),
) as Record<AskCategory, string[]>;

export interface LastAskInfo {
  name: boolean;
  business: boolean;
  state: boolean;
  stateGuess: boolean;
  address: boolean;
  payout: boolean;
}

/** Classify the previous assistant text as an onboarding ask (EN or ES). */
export function classifyLastAsk(content: string): LastAskInfo {
  const c = (content ?? "").trim();
  const hit = (cat: AskCategory): boolean =>
    c.length > 0 && ASK_PREFIXES[cat].some((p) => c.startsWith(p));
  return {
    name: hit("name"),
    business: hit("business"),
    state: hit("state"),
    stateGuess: hit("stateGuess"),
    address: hit("address"),
    payout: hit("payout"),
  };
}

/** Pull a single email out of a free-text reply. */
export function extractEmail(raw: string): string | undefined {
  const m = raw.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  return m ? m[0].toLowerCase() : undefined;
}

/** Heuristic payment-handle parse. Returns the FIRST method we recognize
 *  with its handle (if any). The acceptedPaymentMethods shape supports
 *  multiple — onboarding intentionally captures only one to stay light;
 *  the user can add more from Settings later. */
export interface ParsedPayout {
  method: "venmo" | "zelle" | "cashapp" | "ach" | "check" | "cash" | "other";
  handle?: string;
}
export function extractPayout(raw: string): ParsedPayout | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const lower = t.toLowerCase();
  // Venmo @handle
  let m = lower.match(/venmo[^a-z0-9@]*(@?[a-z0-9._-]+)?/);
  if (m) {
    return {
      method: "venmo",
      handle: m[1] ? (m[1].startsWith("@") ? m[1] : `@${m[1]}`) : undefined,
    };
  }
  // Cash App $tag
  m = lower.match(/cash\s*app[^a-z0-9$]*(\$?[a-z0-9._-]+)?/);
  if (m) {
    return {
      method: "cashapp",
      handle: m[1] ? (m[1].startsWith("$") ? m[1] : `$${m[1]}`) : undefined,
    };
  }
  m = lower.match(
    /zelle[^a-z0-9@]*([\w.+-]+@[\w-]+(?:\.[\w-]+)+|\+?\d[\d\s().-]{6,})?/,
  );
  if (m) return { method: "zelle", handle: m[1]?.trim() };
  if (/\bach\b|wire/i.test(t)) return { method: "ach" };
  if (/\bcheck\b/i.test(t)) return { method: "check" };
  if (/\bcash\b/i.test(t)) return { method: "cash" };
  return undefined;
}

// US_STATES + STATE_NAME_TO_CODE derived below; the source tables and the
// phone→state helpers now live in @core/business/us-states (imported + re-
// exported at the top of this file).
const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
);

/** Did the user reply something that means "yes, that's right"?
 *  Used after a phone-area-code state guess. Delegates to the shared
 *  bilingual parser (EN mirrors the old inline regex; ES adds sí/si ·
 *  claro · correcto · así es — P-23: "sí" must confirm, not reprompt). */
export function isAffirmativeReply(text: string): boolean {
  if (!text) return false;
  return matchesConfirmIntent(text);
}

/** Compose the state-ask, optionally with a phone-derived guess. */
export function onboardAskStateWithGuess(
  firstName: string,
  phone: string | undefined,
  lang: Lang = "en",
): string {
  const guess = stateFromPhone(phone);
  if (!guess) return ONBOARD_ASK_STATE(firstName, lang);
  const stateName = US_STATES[guess];
  const code = areaCodeFromPhone(phone) ?? "";
  return t(lang, "onboarding.askStateGuess", { stateName, code, firstName });
}

export interface ParsedAddress {
  street?: string;
  city?: string;
  state?: string;
  postal?: string;
}

/** Free-form US-address parser. Aimed at the onboarding "paste it on one
 *  line" reply. Handles the common shapes:
 *    "123 Main St, Austin, TX 78701"
 *    "123 Main St, Austin TX 78701"
 *    "123 Main St Austin TX 78701"
 *    "Austin, TX 78701"          (city + state + zip, no street)
 *    "TX 78701"                   (state + zip only)
 *    "78701"                      (zip only)
 *  Returns whatever fields it could pull. The caller decides if enough
 *  was captured to consider the question answered. */
export function extractAddressOnly(input: string): ParsedAddress | undefined {
  if (!input) return undefined;
  const raw = input.trim().replace(/\s+/g, " ");
  if (!raw) return undefined;
  if (raw.length > 180) return undefined;
  // Pull a 5-digit (optional +4) zip if present.
  const zipMatch = raw.match(/\b(\d{5})(?:-?\d{4})?\b/);
  const postal = zipMatch?.[1];
  // Pull a state — either 2-letter code or full name.
  let state: string | undefined;
  const codeMatch = raw.match(/\b([A-Za-z]{2})\b\s*(?:\d{5})?$/);
  if (codeMatch) {
    const cand = codeMatch[1].toUpperCase();
    if (US_STATES[cand]) state = cand;
  }
  if (!state) {
    for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
      const re = new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (re.test(raw)) {
        state = code;
        break;
      }
    }
  }
  // Strip zip + state from the end so we can split the rest by commas.
  let rest = raw;
  if (postal) {
    rest = rest.replace(new RegExp(`\\b${postal}(?:-?\\d{4})?\\b\\s*$`), "")
      .trim();
  }
  if (state) {
    rest = rest.replace(new RegExp(`\\b${state}\\b\\s*$`, "i"), "").trim();
    rest = rest.replace(new RegExp(`,?\\s*${state}\\s*,?$`, "i"), "").trim();
  }
  // Drop trailing commas/whitespace.
  rest = rest.replace(/[,\s]+$/, "");
  // Split remaining on commas. Last part = city, anything before = street.
  const parts = rest.split(",").map((p) => p.trim()).filter(Boolean);
  let street: string | undefined;
  let city: string | undefined;
  if (parts.length >= 2) {
    city = parts[parts.length - 1];
    street = parts.slice(0, -1).join(", ");
  } else if (parts.length === 1) {
    // Heuristic: if it starts with a number, treat as street, else as city.
    if (/^\d/.test(parts[0])) street = parts[0];
    else city = parts[0];
  }
  // Refuse near-empty parses (we want at least state+zip OR city).
  if (!street && !city && !state && !postal) return undefined;
  return {
    ...(street ? { street } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(postal ? { postal } : {}),
  };
}

/** LLM fallback for free-form addresses the regex couldn't parse —
 *  e.g. "219 delano way myrtle beach sc" (no commas, lowercase, no zip).
 *  We pass the user's raw text through a tiny strict-JSON system prompt
 *  and validate the response. The caller decides if the result is
 *  "good enough" (typically: state OR (street+city)) before persisting.
 *
 *  Imported here without a hard dependency: callers pass the LLMClient
 *  directly so this module stays pure-business and doesn't drag the
 *  agents-module DI container into compilation. */
export interface AddressLLMClient {
  respond(req: {
    systemPrompt: string;
    messages: { role: "user" | "assistant" | "system"; content: string }[];
    userId: string;
  }): Promise<{ text: string }>;
}

const ADDRESS_LLM_PROMPT = t("en", "prompts.onboardingAddress");

export async function extractAddressViaLLM(
  llm: AddressLLMClient,
  text: string,
  userId: string,
): Promise<ParsedAddress | undefined> {
  if (!text || text.trim().length === 0 || text.length > 240) return undefined;
  let raw: string;
  try {
    const res = await llm.respond({
      systemPrompt: ADDRESS_LLM_PROMPT,
      messages: [{ role: "user", content: text.trim() }],
      userId,
    });
    raw = res.text ?? "";
  } catch {
    return undefined;
  }
  // The model may still wrap in code fences or add prose — pull the first
  // JSON-object substring and parse defensively.
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) return undefined;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return undefined;
  }
  const out: ParsedAddress = {};
  if (typeof obj.street === "string" && obj.street.trim()) {
    out.street = obj.street.trim();
  }
  if (typeof obj.city === "string" && obj.city.trim()) {
    out.city = obj.city.trim();
  }
  if (typeof obj.state === "string" && obj.state.trim()) {
    const s = obj.state.trim().toUpperCase();
    if (US_STATES[s]) out.state = s;
  }
  if (typeof obj.postal === "string") {
    const p = obj.postal.trim();
    if (/^\d{5}$/.test(p)) out.postal = p;
  }
  if (!out.street && !out.city && !out.state && !out.postal) return undefined;
  return out;
}

/** Parse a state reply: accepts 2-letter code (case-insensitive) or
 *  a full state name. Returns the canonical 2-letter UPPERCASE code or
 *  undefined when the input doesn't look like a US state. */
export function extractStateOnly(input: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim().replace(/[!?.,]+$/, "");
  if (!trimmed) return undefined;
  // Strip "I'm in / We're in / it's / based in" prefixes.
  const stripped = trimmed.replace(
    /^(?:i'?m\s+in|we'?re\s+in|based\s+in|it'?s|in)\s+/i,
    "",
  ).trim();
  // 2-letter code path
  if (/^[A-Za-z]{2}$/.test(stripped)) {
    const code = stripped.toUpperCase();
    if (US_STATES[code]) return code;
    return undefined;
  }
  // Full-name path
  const lower = stripped.toLowerCase();
  if (STATE_NAME_TO_CODE[lower]) return STATE_NAME_TO_CODE[lower];
  return undefined;
}

/** Looser name-only extractor for the single-question flow. Whole reply
 *  is treated as a name candidate (after stripping prefixes), as long as
 *  it doesn't look like a job request and is short. */
export function extractNameOnly(input: string): string | undefined {
  const combined = extractNameAndBusiness(input);
  if (combined?.name) return combined.name;
  // Fallback: maybe the user typed just "rafa" lowercase or
  // "the name's Rafa" — try the prefix-stripped path too.
  if (!input) return undefined;
  const trimmed = input.trim().replace(/[!?.]+$/, "");
  if (trimmed.length === 0 || trimmed.length > 40) return undefined;
  if (QUOTE_SIGNAL_RE.test(trimmed)) return undefined;
  const stripped = trimmed.replace(PREFIX_RE, "").trim();
  if (!stripped) return undefined;
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return undefined;
  if (/\d/.test(stripped)) return undefined;
  if (!/^[A-Za-z]/.test(tokens[0])) return undefined;
  if (tokens.length === 1 && STOP_WORDS.has(tokens[0].toLowerCase())) {
    return undefined;
  }
  return tokens.length === 1 && tokens[0] === tokens[0].toLowerCase()
    ? tokens[0][0].toUpperCase() + tokens[0].slice(1)
    : stripped;
}

/** Liberal business-name extractor for the single-question flow. We
 *  already know the user is answering "what's your business called?"
 *  so any short, non-job-shaped reply is fair game. */
export function extractBusinessOnly(input: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim().replace(/[!?]+$/, "");
  if (!trimmed) return undefined;
  if (trimmed.length > 80) return undefined;
  if (QUOTE_SIGNAL_RE.test(trimmed)) return undefined;
  if (isSkipReply(trimmed)) return undefined;
  // Strip a leading "It's / We're / We are / I'm" if the user phrases it
  // conversationally — "It's Riley Roofing Co.".
  const stripped = trimmed
    .replace(
      /^(?:it'?s|we'?re|we\s+are|i'?m|it\s+is|the\s+business\s+is|business\s+is|company\s+is|called)\s+/i,
      "",
    )
    .trim();
  if (!stripped) return undefined;
  // Must contain at least one letter (rule out "..." / "—").
  if (!/[A-Za-z]/.test(stripped)) return undefined;
  return stripped;
}
