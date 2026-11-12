/**
 * REQ-230 (demo issue M14) — the assistant's in-flight flow, kept ON the
 * conversation (server-side) so any reload rebuilds it: the contractor's own,
 * or another window's (the demo stage is an independent copy of the app with
 * no access to the contractor's sessionStorage).
 *
 * Before this, the only server write before price Continue was the typed
 * note (POST /agents/conversations/:id/draft {note}); the job options, the
 * pick, the price and every view flag lived in island useState plus a per-tab
 * sessionStorage back-stack, so GET /agents/conversations/:id held one user
 * message while the contractor sat on the options or the price.
 *
 * One wire shape, used by both sides:
 *   - the island (front-end/islands/AsstChat.tsx) builds it from its state
 *     and POSTs it as `{ draft }`; it seeds its state from `restorableDraft`
 *     of the draft the route SSR-loaded;
 *   - the backend (conversations-controller `POST /:id/draft`) runs
 *     `parseAssistantDraft` on it before storing, and LoadConversation hands
 *     it back on `GET /:id` as `draft`.
 */

export interface DraftBullet {
  id: string;
  text: string;
  deleted: boolean;
}

/** One editable job-details option (mirrors the island's JobOptionDraft). */
export interface DraftOption {
  id: string;
  jobName: string;
  summary: string;
  bullets: DraftBullet[];
  byLang?: Record<
    string,
    { jobName: string; summary: string; bullets: string[] }
  >;
}

export interface DraftPriceSuggestion {
  tier: "competitive" | "market" | "premium";
  label: string;
  priceCents: number;
  rationale: string;
}

export interface AssistantDraft {
  /** Which starter chip opened the flow (starter-chips ChipKey). */
  flowChip: string | null;
  /** "Help me price it" — the price step offers suggested tiers. */
  suggestPricing: boolean;
  /** "Job done, need to invoice" — Continue runs the invoice wizard. */
  invoiceFlow: boolean;
  /** The job-details entry is open (composer is the answer surface). */
  awaitingJobDetails: boolean;
  /** The job details being priced (what Continue builds the quote from). */
  jobDetailsRaw: string | null;
  /** The details as the contractor submitted them (the bubble). */
  submittedJobDetails: string | null;
  /** The Job Details picker is open. */
  jobOptionsOpen: boolean;
  /** "confirm" = pre-quote picker (help me price it); "polish" = end of wizard. */
  pickerMode: "polish" | "confirm";
  /** The generated options as the contractor left them (edits included). */
  jobOptions: DraftOption[] | null;
  /** The options are heuristic scope bullets (the model failed). */
  optionsDegraded: boolean;
  /** The option currently selected in the picker. */
  selectedOptionId: string | null;
  /** The option confirmed in "confirm" mode — seeds the quote at Continue. */
  confirmedOption: DraftOption | null;
  /** The price step is open. */
  priceCaptureOpen: boolean;
  /** The price typed / picked on the price step. */
  priceCents: number | null;
  /** The suggested tiers shown on the price step ("help me price it"). */
  priceSuggestions: DraftPriceSuggestion[] | null;
  /** The "Ready to send" CTA whose quote review is open. */
  previewCtaId: string | null;
  /** Raw details that still owe the end-of-wizard Job Details picker. */
  polishRaw: string | null;
}

export function emptyAssistantDraft(): AssistantDraft {
  return {
    flowChip: null,
    suggestPricing: false,
    invoiceFlow: false,
    awaitingJobDetails: false,
    jobDetailsRaw: null,
    submittedJobDetails: null,
    jobOptionsOpen: false,
    pickerMode: "polish",
    jobOptions: null,
    optionsDegraded: false,
    selectedOptionId: null,
    confirmedOption: null,
    priceCaptureOpen: false,
    priceCents: null,
    priceSuggestions: null,
    previewCtaId: null,
    polishRaw: null,
  };
}

// Bounds: what one client can park on a conversation.
const MAX_TEXT = 8_000;
const MAX_SHORT = 500;
const MAX_ID = 200;
const MAX_OPTIONS = 8;
const MAX_BULLETS = 50;
const MAX_LANGS = 4;
const MAX_SUGGESTIONS = 4;
const MAX_CENTS = 100_000_000_000; // $1bn
const TIERS = new Set(["competitive", "market", "premium"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown, max: number): string | null {
  return typeof v === "string" ? v.slice(0, max) : null;
}

function bool(v: unknown): boolean {
  return v === true;
}

function cents(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 &&
      v <= MAX_CENTS
    ? v
    : null;
}

function parseBullet(v: unknown): DraftBullet | null {
  if (!isObj(v)) return null;
  const id = str(v.id, MAX_ID);
  const text = str(v.text, MAX_SHORT * 2);
  if (!id || text === null) return null;
  return { id, text, deleted: bool(v.deleted) };
}

function parseByLang(v: unknown): DraftOption["byLang"] | undefined {
  if (!isObj(v)) return undefined;
  const out: NonNullable<DraftOption["byLang"]> = {};
  for (const [lang, entry] of Object.entries(v).slice(0, MAX_LANGS)) {
    if (!/^[a-z]{2}$/.test(lang) || !isObj(entry)) continue;
    const jobName = str(entry.jobName, MAX_SHORT);
    const summary = str(entry.summary, MAX_TEXT);
    if (jobName === null || summary === null) continue;
    const bullets = Array.isArray(entry.bullets)
      ? entry.bullets.slice(0, MAX_BULLETS)
        .map((b) => str(b, MAX_SHORT * 2))
        .filter((b): b is string => b !== null)
      : [];
    out[lang] = { jobName, summary, bullets };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseOption(v: unknown): DraftOption | null {
  if (!isObj(v)) return null;
  const id = str(v.id, MAX_ID);
  const jobName = str(v.jobName, MAX_SHORT);
  const summary = str(v.summary, MAX_TEXT);
  if (!id || jobName === null || summary === null) return null;
  const bullets = Array.isArray(v.bullets)
    ? v.bullets.slice(0, MAX_BULLETS).map(parseBullet)
      .filter((b): b is DraftBullet => b !== null)
    : [];
  const byLang = parseByLang(v.byLang);
  return { id, jobName, summary, bullets, ...(byLang ? { byLang } : {}) };
}

function parseSuggestion(v: unknown): DraftPriceSuggestion | null {
  if (!isObj(v) || typeof v.tier !== "string" || !TIERS.has(v.tier)) {
    return null;
  }
  const priceCents = cents(v.priceCents);
  const label = str(v.label, MAX_SHORT);
  if (priceCents === null || label === null) return null;
  return {
    tier: v.tier as DraftPriceSuggestion["tier"],
    label,
    priceCents,
    rationale: str(v.rationale, MAX_TEXT) ?? "",
  };
}

/**
 * The server's gate on what a client sends: anything that is not an object
 * is refused (null); every field is type-checked and bounded, a malformed
 * one falls back to the empty draft's value, unknown fields are dropped.
 */
export function parseAssistantDraft(input: unknown): AssistantDraft | null {
  if (!isObj(input)) return null;
  const base = emptyAssistantDraft();
  const options = Array.isArray(input.jobOptions)
    ? input.jobOptions.slice(0, MAX_OPTIONS).map(parseOption)
      .filter((o): o is DraftOption => o !== null)
    : null;
  const suggestions = Array.isArray(input.priceSuggestions)
    ? input.priceSuggestions.slice(0, MAX_SUGGESTIONS).map(parseSuggestion)
      .filter((s): s is DraftPriceSuggestion => s !== null)
    : null;
  return {
    ...base,
    flowChip: str(input.flowChip, MAX_ID),
    suggestPricing: bool(input.suggestPricing),
    invoiceFlow: bool(input.invoiceFlow),
    awaitingJobDetails: bool(input.awaitingJobDetails),
    jobDetailsRaw: str(input.jobDetailsRaw, MAX_TEXT),
    submittedJobDetails: str(input.submittedJobDetails, MAX_TEXT),
    jobOptionsOpen: bool(input.jobOptionsOpen),
    pickerMode: input.pickerMode === "confirm" ? "confirm" : "polish",
    jobOptions: options,
    optionsDegraded: bool(input.optionsDegraded),
    selectedOptionId: str(input.selectedOptionId, MAX_ID),
    confirmedOption: parseOption(input.confirmedOption),
    priceCaptureOpen: bool(input.priceCaptureOpen),
    priceCents: cents(input.priceCents),
    priceSuggestions: suggestions && suggestions.length > 0
      ? suggestions
      : null,
    previewCtaId: str(input.previewCtaId, MAX_ID),
    polishRaw: str(input.polishRaw, MAX_TEXT),
  };
}

/** True when the draft carries no flow at all — a plain chat never writes one. */
export function isBlankDraft(d: AssistantDraft): boolean {
  return JSON.stringify(d) === JSON.stringify(emptyAssistantDraft());
}

/**
 * What a reload paints from a stored draft. Before Continue (no quote bound)
 * every panel comes back exactly. After Continue the quote exists and the
 * conversation is in the wizard: the pre-quote panels (details entry, price
 * step, the confirm-mode picker) stay closed — their data is kept — while the
 * end-of-wizard picker and an open review come back. The review only reopens
 * when its CTA message is still in the transcript.
 */
export function restorableDraft(
  d: AssistantDraft,
  ctx: { quoteBound: boolean; messageIds: string[] },
): AssistantDraft {
  const previewCtaId = d.previewCtaId && ctx.messageIds.includes(d.previewCtaId)
    ? d.previewCtaId
    : null;
  if (!ctx.quoteBound) return { ...d, previewCtaId };
  return {
    ...d,
    awaitingJobDetails: false,
    priceCaptureOpen: false,
    jobOptionsOpen: d.jobOptionsOpen && d.pickerMode === "polish",
    previewCtaId,
  };
}

/** The highest `bN` bullet id in the draft, so bullets added after a restore
 *  never reuse a restored id. */
export function maxBulletSeq(d: AssistantDraft): number {
  let max = 0;
  const all = [
    ...(d.jobOptions ?? []),
    ...(d.confirmedOption ? [d.confirmedOption] : []),
  ];
  for (const o of all) {
    for (const b of o.bullets) {
      const m = /^b(\d+)$/.exec(b.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max;
}
