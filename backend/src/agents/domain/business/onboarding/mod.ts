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

const PREFIX_RE = /^(?:i'?m|i\s+am|it'?s|name'?s|name\s+is|this\s+is|call\s+me|hi[, ]+i'?m|hey[, ]+i'?m)\s+/i;
const SEPARATOR_RE = /(?:,|\s+(?:from|at|of|with|—|-|–))\s+/i;
const QUOTE_SIGNAL_RE = /(\$\s*\d|\b\d+\s*(?:sqft|sq\.?\s*ft|sq|hours?|hrs?|days?|gal|panels?|pieces?|units?|ft)\b|\bquote\b|\binvoice\b|\bnudge\b|\bfollow\s*up\b|\bdraft\b|\bestimate\b|\bbid\b)/i;
const SKIP_RE = /^\s*(?:skip|later|not\s+now|nah|no\s+thanks?|pass|maybe\s+later|nope)\b/i;
/**
 * Words that look name-shaped (capitalised, single token) but obviously
 * aren't names. The extractor would otherwise greedily lock these in.
 */
const STOP_WORDS = new Set([
  "hey", "hi", "hello", "hola", "yo", "sup", "ok", "okay", "k", "kk",
  "morning", "afternoon", "evening", "good", "thanks", "thank", "ty",
  "yes", "yeah", "yep", "yup", "no", "nope", "sure", "test", "testing",
  "help", "wait", "hmm", "uhh", "uh", "um", "umm",
]);

export interface OnboardingExtraction {
  name?: string;
  businessName?: string;
}

export function isSkipReply(text: string): boolean {
  if (!text) return false;
  return SKIP_RE.test(text);
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
const TRADE_RE = /\b(?:fence|deck|roof(?:ing)?|gutter|paint(?:ing)?|epoxy|floor(?:ing)?|garage|kitchen|bath(?:room)?|patio|driveway|tile|plumb(?:ing)?|electric(?:al|ian)?|hvac|window|door|siding|drywall|insulat(?:e|ion)|landscap(?:e|ing)|concrete|carpentr?y|repair|install(?:ation)?|remodel|renovat(?:e|ion)|backsplash|shingle|stucco|trim)\b/i;
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
export function extractNameAndBusiness(input: string): OnboardingExtraction | undefined {
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
  const name = nameWords.length === 1 && nameWords[0] === nameWords[0].toLowerCase()
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
export const ONBOARDING_ASK_TEXT =
  "Hey 👋 quick one before we start — what should I call you? (And what's your business name, if it's different?)";

/** Single-question onboarding asks — used when we know exactly which
 *  field is missing and want to keep the conversation feeling like a
 *  one-thing-at-a-time chat instead of a form. */
export const ONBOARD_ASK_NAME =
  "Hey there 👋 I'm Bossie — your assistant. What should I call you?";
export const ONBOARD_ASK_BUSINESS = (firstName: string): string =>
  `Nice to meet you, ${firstName}! And what's your business called?`;
export const ONBOARD_ASK_STATE = (firstName: string): string =>
  `Almost there. Which state are you in, ${firstName}? (e.g. CA, TX, NY — used on your contracts)`;
export const ONBOARD_ASK_ADDRESS = (firstName: string): string =>
  `Last one, ${firstName} — what's your business address? Paste it on one line: street, city, state zip (e.g. "123 Main St, Austin, TX 78701"). Solo / no office? Just say "skip".`;
export const ONBOARD_HANDOFF = (firstName: string): string =>
  `Awesome — we're set, ${firstName}. Okay, can we start with your first quote? Tell me anything — for example: "I have a full bathroom remodel down to the studs, I would like to rebuild the bathroom."`;

/** Two-letter US state abbreviations → full names. Used by the state
 *  extractor and surfaced on customer-facing contracts. */
export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
);

/** US area code → 2-letter state. Covers the high-frequency codes used
 *  by tradespeople (mostly metro areas + the obvious split states).
 *  Multi-state codes resolve to the most populous one — the user can
 *  override the guess if it's wrong. */
const AREA_CODE_STATE: Record<string, string> = {
  // Alabama
  "205": "AL", "251": "AL", "256": "AL", "334": "AL", "938": "AL",
  // Alaska
  "907": "AK",
  // Arizona
  "480": "AZ", "520": "AZ", "602": "AZ", "623": "AZ", "928": "AZ",
  // Arkansas
  "479": "AR", "501": "AR", "870": "AR",
  // California
  "209": "CA", "213": "CA", "279": "CA", "310": "CA", "323": "CA", "341": "CA",
  "408": "CA", "415": "CA", "424": "CA", "442": "CA", "510": "CA", "530": "CA",
  "559": "CA", "562": "CA", "619": "CA", "626": "CA", "628": "CA", "650": "CA",
  "657": "CA", "661": "CA", "669": "CA", "707": "CA", "714": "CA", "747": "CA",
  "760": "CA", "805": "CA", "818": "CA", "820": "CA", "831": "CA", "858": "CA",
  "909": "CA", "916": "CA", "925": "CA", "949": "CA", "951": "CA",
  // Colorado
  "303": "CO", "719": "CO", "720": "CO", "970": "CO",
  // Connecticut
  "203": "CT", "475": "CT", "860": "CT", "959": "CT",
  // Delaware
  "302": "DE",
  // DC
  "202": "DC",
  // Florida
  "239": "FL", "305": "FL", "321": "FL", "352": "FL", "386": "FL", "407": "FL",
  "561": "FL", "689": "FL", "727": "FL", "754": "FL", "772": "FL", "786": "FL",
  "813": "FL", "850": "FL", "863": "FL", "904": "FL", "941": "FL", "954": "FL",
  // Georgia
  "229": "GA", "404": "GA", "470": "GA", "478": "GA", "678": "GA", "706": "GA",
  "762": "GA", "770": "GA", "912": "GA",
  // Hawaii
  "808": "HI",
  // Idaho
  "208": "ID", "986": "ID",
  // Illinois
  "217": "IL", "224": "IL", "309": "IL", "312": "IL", "331": "IL", "447": "IL",
  "618": "IL", "630": "IL", "708": "IL", "773": "IL", "779": "IL", "815": "IL",
  "847": "IL", "872": "IL",
  // Indiana
  "219": "IN", "260": "IN", "317": "IN", "463": "IN", "574": "IN", "765": "IN", "812": "IN", "930": "IN",
  // Iowa
  "319": "IA", "515": "IA", "563": "IA", "641": "IA", "712": "IA",
  // Kansas
  "316": "KS", "620": "KS", "785": "KS", "913": "KS",
  // Kentucky
  "270": "KY", "364": "KY", "502": "KY", "606": "KY", "859": "KY",
  // Louisiana
  "225": "LA", "318": "LA", "337": "LA", "504": "LA", "985": "LA",
  // Maine
  "207": "ME",
  // Maryland
  "227": "MD", "240": "MD", "301": "MD", "410": "MD", "443": "MD", "667": "MD",
  // Massachusetts
  "339": "MA", "351": "MA", "413": "MA", "508": "MA", "617": "MA", "774": "MA", "781": "MA", "857": "MA", "978": "MA",
  // Michigan
  "231": "MI", "248": "MI", "269": "MI", "313": "MI", "517": "MI", "586": "MI",
  "616": "MI", "734": "MI", "810": "MI", "906": "MI", "947": "MI", "989": "MI",
  // Minnesota
  "218": "MN", "320": "MN", "507": "MN", "612": "MN", "651": "MN", "763": "MN", "952": "MN",
  // Mississippi
  "228": "MS", "601": "MS", "662": "MS", "769": "MS",
  // Missouri
  "314": "MO", "417": "MO", "557": "MO", "573": "MO", "636": "MO", "660": "MO", "816": "MO", "975": "MO",
  // Montana
  "406": "MT",
  // Nebraska
  "308": "NE", "402": "NE", "531": "NE",
  // Nevada
  "702": "NV", "725": "NV", "775": "NV",
  // New Hampshire
  "603": "NH",
  // New Jersey
  "201": "NJ", "551": "NJ", "609": "NJ", "640": "NJ", "732": "NJ", "848": "NJ", "856": "NJ", "862": "NJ", "908": "NJ", "973": "NJ",
  // New Mexico
  "505": "NM", "575": "NM",
  // New York
  "212": "NY", "315": "NY", "332": "NY", "347": "NY", "363": "NY", "516": "NY",
  "518": "NY", "585": "NY", "607": "NY", "631": "NY", "646": "NY", "680": "NY",
  "716": "NY", "718": "NY", "838": "NY", "845": "NY", "914": "NY", "917": "NY", "929": "NY", "934": "NY",
  // North Carolina
  "252": "NC", "336": "NC", "472": "NC", "704": "NC", "743": "NC", "828": "NC", "910": "NC", "919": "NC", "980": "NC", "984": "NC",
  // North Dakota
  "701": "ND",
  // Ohio
  "216": "OH", "220": "OH", "234": "OH", "283": "OH", "326": "OH", "330": "OH",
  "380": "OH", "419": "OH", "440": "OH", "513": "OH", "567": "OH", "614": "OH", "740": "OH", "937": "OH",
  // Oklahoma
  "405": "OK", "539": "OK", "572": "OK", "580": "OK", "918": "OK",
  // Oregon
  "458": "OR", "503": "OR", "541": "OR", "971": "OR",
  // Pennsylvania
  "215": "PA", "223": "PA", "267": "PA", "272": "PA", "412": "PA", "445": "PA",
  "484": "PA", "570": "PA", "582": "PA", "610": "PA", "717": "PA", "724": "PA",
  "814": "PA", "835": "PA", "878": "PA",
  // Rhode Island
  "401": "RI",
  // South Carolina
  "803": "SC", "843": "SC", "854": "SC", "864": "SC",
  // South Dakota
  "605": "SD",
  // Tennessee
  "423": "TN", "615": "TN", "629": "TN", "731": "TN", "865": "TN", "901": "TN", "931": "TN",
  // Texas
  "210": "TX", "214": "TX", "254": "TX", "281": "TX", "325": "TX", "346": "TX",
  "361": "TX", "409": "TX", "430": "TX", "432": "TX", "469": "TX", "512": "TX",
  "682": "TX", "713": "TX", "726": "TX", "737": "TX", "806": "TX", "817": "TX",
  "830": "TX", "832": "TX", "903": "TX", "915": "TX", "936": "TX", "940": "TX",
  "945": "TX", "956": "TX", "972": "TX", "979": "TX",
  // Utah
  "385": "UT", "435": "UT", "801": "UT",
  // Vermont
  "802": "VT",
  // Virginia
  "276": "VA", "434": "VA", "540": "VA", "571": "VA", "703": "VA", "757": "VA", "804": "VA", "826": "VA", "948": "VA",
  // Washington
  "206": "WA", "253": "WA", "360": "WA", "425": "WA", "509": "WA", "564": "WA",
  // West Virginia
  "304": "WV", "681": "WV",
  // Wisconsin
  "262": "WI", "274": "WI", "353": "WI", "414": "WI", "534": "WI", "608": "WI", "715": "WI", "920": "WI",
  // Wyoming
  "307": "WY",
};

/** Pull a 3-digit US area code from a phone number in any common shape:
 *  +15125550100 / (512) 555-0100 / 512.555.0100. */
export function areaCodeFromPhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  // Strip leading 1 country code if present.
  const us = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (us.length < 3) return undefined;
  return us.slice(0, 3);
}

/** Returns the 2-letter state for a US phone, or undefined if the area
 *  code isn't in our table. */
export function stateFromPhone(phone: string | undefined): string | undefined {
  const code = areaCodeFromPhone(phone);
  if (!code) return undefined;
  return AREA_CODE_STATE[code];
}

/** Did the user reply something that means "yes, that's right"?
 *  Used after a phone-area-code state guess. */
export function isAffirmativeReply(text: string): boolean {
  if (!text) return false;
  return /^\s*(?:yes|yep|yup|yeah|yea|y|sure|correct|right|that'?s\s+right|that\s+is\s+right|exactly|sounds?\s+(?:good|right)|👍|✅)\b/i.test(text.trim());
}

/** Compose the state-ask, optionally with a phone-derived guess. */
export function onboardAskStateWithGuess(firstName: string, phone: string | undefined): string {
  const guess = stateFromPhone(phone);
  if (!guess) return ONBOARD_ASK_STATE(firstName);
  const stateName = US_STATES[guess];
  const code = areaCodeFromPhone(phone);
  return `Almost there. Looks like you're in ${stateName} (${code} area code) — sound right, ${firstName}? Or tell me the right state.`;
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
      if (re.test(raw)) { state = code; break; }
    }
  }
  // Strip zip + state from the end so we can split the rest by commas.
  let rest = raw;
  if (postal) rest = rest.replace(new RegExp(`\\b${postal}(?:-?\\d{4})?\\b\\s*$`), "").trim();
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

const ADDRESS_LLM_PROMPT = `You parse US business addresses from free-form text.
Reply with EXACTLY one JSON object on a single line, no markdown, no prose, no code fences.
Schema: {"street":"...","city":"...","state":"XX","postal":"..."}
Rules:
- "state" must be a 2-letter US state code (UPPERCASE) — or empty string if unknown.
- "postal" is a 5-digit zip — or empty string if not present in the text. NEVER invent a zip.
- "street" includes the house number plus street name (e.g. "219 Delano Way"). Empty if not present.
- "city" is the city/town name only (e.g. "Myrtle Beach"). Empty if not present.
- Title-case street and city; uppercase state.
- If the text is clearly NOT an address, reply: {"street":"","city":"","state":"","postal":""}`;

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
  try { obj = JSON.parse(m[0]); } catch { return undefined; }
  const out: ParsedAddress = {};
  if (typeof obj.street === "string" && obj.street.trim()) out.street = obj.street.trim();
  if (typeof obj.city === "string" && obj.city.trim()) out.city = obj.city.trim();
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
  if (tokens.length === 1 && STOP_WORDS.has(tokens[0].toLowerCase())) return undefined;
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
    .replace(/^(?:it'?s|we'?re|we\s+are|i'?m|it\s+is|the\s+business\s+is|business\s+is|company\s+is|called)\s+/i, "")
    .trim();
  if (!stripped) return undefined;
  // Must contain at least one letter (rule out "..." / "—").
  if (!/[A-Za-z]/.test(stripped)) return undefined;
  return stripped;
}
