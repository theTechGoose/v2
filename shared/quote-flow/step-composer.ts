/**
 * REQ-392 (demo-loop cycle 2, M7; cycle 1 M9) — "There is no chat box during
 * parts of the guided flow": at Pick a price, on "Who is this for?" and on the
 * Ready-to-send card the contractor could not tell the assistant "that's
 * wrong, it's the whole job".
 *
 * The big composer stays off the tap steps (REQ-041 NW-53b: "if they are
 * tapping options there should be no input field"); a compact "Tell the
 * assistant…" box takes its place there, and what is typed in it goes to
 * POST /agents/chat with the step it was typed on. Pure rules, shared by the
 * island and the server:
 *
 *   composerMode       — which composer the chat shows (full / compact on a
 *                        step / none)
 *   parseChatStepHint  — the step hint off the wire (junk → no hint)
 *   statedPriceCents   — the one price a correction names ("more like $28k"),
 *                        for the price box
 */

/** The guided steps that carry the compact composer. */
export type ChatStepId = "price" | "job_details" | "wizard" | "review";

export const CHAT_STEP_IDS: readonly ChatStepId[] = [
  "price",
  "job_details",
  "wizard",
  "review",
];

/** What a message typed in the compact composer carries to the server. */
export interface ChatStepHint {
  id: ChatStepId;
  /** wizard: the open question's step id ("customer", "start_date", …). */
  wizardStepId?: string;
  /** price / job_details: the job as the contractor typed it — there is no
   *  quote yet on the confirm picker or the price step. */
  job?: string;
  /** price: the confirmed scope bullets; job_details: the version on screen. */
  scope?: string;
  /** price: the three suggested tiers are on screen — re-price them. */
  tiers?: boolean;
  /** price: REQ-444 (demo-loop cycle 3, M21) — the tiers on screen, so a
   *  question about them ("does this include the quartz material?") is
   *  answered from what the contractor sees. */
  options?: StepTier[];
  /** price: REQ-444 — what the tiers on screen include. */
  basis?: StepPriceBasis;
}

/** REQ-444: one suggested tier as the price step shows it. */
export interface StepTier {
  label: string;
  /** INTEGER CENTS. */
  priceCents: number;
  rationale?: string;
}

/** REQ-444: what the suggested prices include (the tier cards' basis line). */
export type StepPriceBasis = "labor_and_materials" | "labor_materials_as_noted";

const STEP_BASES: readonly StepPriceBasis[] = [
  "labor_and_materials",
  "labor_materials_as_noted",
];

/** The most tiers a hint carries (the step shows three). */
const STEP_TIERS_MAX = 4;

/** REQ-444: the tiers off the wire — a label and a positive whole-cents price
 *  each, at most four; anything else is dropped. */
function tiersOf(raw: unknown): StepTier[] {
  if (!Array.isArray(raw)) return [];
  const out: StepTier[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    const label = text(o.label, 60);
    const cents = o.priceCents;
    if (
      !label || typeof cents !== "number" || !Number.isInteger(cents) ||
      cents <= 0
    ) continue;
    const rationale = text(o.rationale, 200);
    out.push({ label, priceCents: cents, ...(rationale ? { rationale } : {}) });
    if (out.length === STEP_TIERS_MAX) break;
  }
  return out;
}

/** The longest job / scope text a hint carries (the job-details endpoints'
 *  own cap). */
export const STEP_TEXT_MAX = 8_000;

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

/** The step hint off the wire. Anything that is not one is no hint — the turn
 *  stays an ordinary chat turn. */
export function parseChatStepHint(raw: unknown): ChatStepHint | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (typeof id !== "string" || !CHAT_STEP_IDS.includes(id as ChatStepId)) {
    return undefined;
  }
  const hint: ChatStepHint = { id: id as ChatStepId };
  const wizardStepId = text(r.wizardStepId, 64);
  if (wizardStepId) hint.wizardStepId = wizardStepId;
  const job = text(r.job, STEP_TEXT_MAX);
  if (job) hint.job = job;
  const scope = text(r.scope, STEP_TEXT_MAX);
  if (scope) hint.scope = scope;
  if (r.tiers === true) hint.tiers = true;
  // REQ-444: the tiers on screen and what they include.
  const options = tiersOf(r.options);
  if (options.length) hint.options = options;
  if (STEP_BASES.includes(r.basis as StepPriceBasis)) {
    hint.basis = r.basis as StepPriceBasis;
  }
  return hint;
}

// ---------------------------------------------------------------------------
// REQ-444 (demo-loop cycle 3, M21): the job details the assistant rewrote on
// Pick a price ("add permit if not")
// ---------------------------------------------------------------------------

/** The new job details a price-step reply carries: the app-language text
 *  and any other language the assistant rewrote. */
export interface StepScope {
  scope: string;
  byLang: Record<string, string>;
}

/** The rewritten job details off a price-step reply's payload (`scope`,
 *  `scopeByLang`); undefined when the reply changed none. */
export function stepScopeOf(payload: unknown): StepScope | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const p = payload as Record<string, unknown>;
  const scope = typeof p.scope === "string" ? p.scope.trim() : "";
  if (!scope) return undefined;
  const byLang: Record<string, string> = {};
  const raw = p.scopeByLang;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [l, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) byLang[l] = v.trim();
    }
  }
  return { scope, byLang };
}

/** The confirmed option, as far as the new job details touch it. */
export interface StepScopedOption {
  bullets: { id: string; text: string; deleted: boolean }[];
  byLang?: Record<
    string,
    { jobName: string; summary: string; bullets: string[] }
  >;
}

const scopeLines = (s: string) =>
  s.split("\n").map((l) => l.trim()).filter(Boolean);

/**
 * The confirmed option with the job details the assistant rewrote on Pick a
 * price: its lines become the new ones (the quote is made from them), the app
 * language's copy too, and another language keeps its copy only when the
 * reply rewrote it — a stale one would drop the new line from the customer's
 * copy, so it is dropped and the send translates it again (REQ-264).
 */
export function withStepScope<O extends StepScopedOption>(
  option: O,
  update: StepScope,
  appLang: string,
): O {
  const lines = scopeLines(update.scope);
  const next: O = {
    ...option,
    bullets: lines.map((text, i) => ({
      id: `scope-${i + 1}`,
      text,
      deleted: false,
    })),
  };
  if (option.byLang) {
    const byLang: NonNullable<StepScopedOption["byLang"]> = {};
    for (const [l, v] of Object.entries(option.byLang)) {
      const text = l === appLang ? update.scope : update.byLang[l];
      if (!text?.trim()) continue;
      byLang[l] = { ...v, bullets: scopeLines(text) };
    }
    next.byLang = byLang;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Which composer
// ---------------------------------------------------------------------------

export interface StepMessageLike {
  kind?: string;
  payload?: unknown;
}

export interface ComposerModeInput {
  priceCaptureOpen: boolean;
  jobOptionsOpen: boolean;
  invoiceReviewOpen: boolean;
  invoiceResultOpen: boolean;
  /** The "tell me the job details" entry — the big composer IS its answer. */
  awaitingJobDetails: boolean;
  /** The Ready-to-send review card is open. */
  previewOpen: boolean;
  messages: readonly StepMessageLike[];
}

export type ComposerMode =
  | { kind: "full" }
  | { kind: "none" }
  | { kind: "step"; step: ChatStepId; wizardStepId?: string };

/** The latest wizard question no pick has answered — `{}` when the card has
 *  no step id — or null when every question is answered. A pick is a text
 *  message carrying `payload.wizardStepId`; a chat turn typed on the step
 *  never is one, so it leaves the question open. */
export function unansweredWizardStep(
  messages: readonly StepMessageLike[],
): { stepId?: string } | null {
  const answered = new Set<string>();
  for (const m of messages) {
    const sid = (m.payload as { wizardStepId?: unknown } | undefined)
      ?.wizardStepId;
    if (m.kind === "text" && typeof sid === "string" && sid) answered.add(sid);
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind !== "wizard") continue;
    const sid = (m.payload as { stepId?: unknown } | undefined)?.stepId;
    if (typeof sid !== "string" || !sid) return {};
    if (!answered.has(sid)) return { stepId: sid };
  }
  return null;
}

/**
 * Which composer the chat shows. The panel on screen decides: Pick a price,
 * the Job details picker, the Ready-to-send review, then an open wizard
 * question each get the compact box (`step`); the invoice review and result
 * screens get none; everything else — a plain chat, the job-details entry —
 * the full composer.
 */
export function composerMode(s: ComposerModeInput): ComposerMode {
  if (s.invoiceReviewOpen || s.invoiceResultOpen) return { kind: "none" };
  if (s.priceCaptureOpen) return { kind: "step", step: "price" };
  if (s.jobOptionsOpen) return { kind: "step", step: "job_details" };
  if (s.previewOpen) return { kind: "step", step: "review" };
  if (!s.awaitingJobDetails) {
    const open = unansweredWizardStep(s.messages);
    if (open) {
      return open.stepId
        ? { kind: "step", step: "wizard", wizardStepId: open.stepId }
        : { kind: "step", step: "wizard" };
    }
  }
  return { kind: "full" };
}

// ---------------------------------------------------------------------------
// The price a correction names
// ---------------------------------------------------------------------------

interface Found {
  cents: number;
  start: number;
  end: number;
}

/** "28" + ".5" + "k" → 2,850,000 cents; "28,000" → 2,800,000. */
function centsOf(whole: string, frac: string | undefined, thousands: boolean) {
  const n = Number(`${whole.replace(/,/g, "")}${frac ? `.${frac}` : ""}`);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * (thousands ? 1000 : 1) * 100);
}

/** Every money amount in the text: "$28,000", "$28k", "$28.5k", "$28 mil",
 *  "28k", "4500 dollars", "28 mil dólares" — each counted once. */
function amounts(t: string): Found[] {
  const found: Found[] = [];
  const overlaps = (s: number) => found.some((f) => s >= f.start && s < f.end);
  const dollar =
    /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s*(k|mil)(?![\p{L}\d]))?(?:\s+(?:d[oó]lares|dollars|usd|bucks))?/giu;
  for (const m of t.matchAll(dollar)) {
    found.push({
      cents: centsOf(m[1], m[2], !!m[3]),
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }
  const worded =
    /(?<![\p{L}\d$.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s*(k)(?![\p{L}\d])|\s+(mil\s+)?(?:d[oó]lares|dollars|usd|bucks)(?![\p{L}]))/giu;
  for (const m of t.matchAll(worded)) {
    if (overlaps(m.index!)) continue;
    found.push({
      cents: centsOf(m[1], m[2], !!(m[3] || m[4])),
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }
  return found.sort((a, b) => a.start - b.start).filter((f) => f.cents > 0);
}

/** Words right before the amount that make it the price ("more like",
 *  "should be", "cóbrale unos"). */
const PRICE_BEFORE = new RegExp(
  "(?<![\\p{L}\\d])(?:" + [
    "more like",
    "closer to",
    "about",
    "around",
    "roughly",
    "approximately",
    "approx\\.?",
    "~",
    "at least",
    "should be",
    "ought to be",
    "needs to be",
    "has to be",
    "make it",
    "call it",
    "price it(?: at| to)?",
    "priced at",
    "set it (?:at|to)",
    "quote it (?:at|for)",
    "charge(?: (?:him|her|them|the customer|the client))?",
    "bump it(?: up)? to",
    "raise it to",
    "lower it to",
    "drop it to",
    "go with",
    "(?:my|the|new) price(?: is|:)?",
    "price is",
    "total of",
    "it'?s",
    "it is",
    "that'?s",
    // Spanish
    "como",
    "unos",
    "alrededor de",
    "aproximadamente",
    "m[aá]s bien",
    "c[oó]brale",
    "c[oó]bra",
    "cobrar",
    "ponle",
    "que sea",
    "(?:el|mi) precio es",
    "precio de",
    "total de",
    "son",
    "es",
  ].join("|") + ")(?:\\s+(?:a|an|un|una))?$",
  "iu",
);

/** Words right after the amount that make it the whole price. */
const PRICE_AFTER =
  /^\s*(?:total|in total|in all|all[- ]in|for everything|for the whole|for it all|for all of it|todo incluido|en total|por todo)/iu;

/** A cost, a deposit or a share — never the job's price. */
const COST_BEFORE =
  /\b(?:costs?|costing|quoted|quotes|charges? me|paid|pay(?:ing)?|spent|materials?|supplies|supplier|subs?|subcontractors?|plumber|electrician|rental|cuesta|cuestan|cobr[oó] el|me cobra|pagu[eé]|materiales)\b[^.!?\n]*$/iu;
const SHARE =
  /%|\b(?:deposits?|down ?payment|upfront|up[- ]front|retainer|anticipos?|adelantos?|enganches?|dep[oó]sitos?)\b/iu;

/**
 * The one price a correction names, INTEGER CENTS — for the price box on Pick
 * a price. Conservative: exactly one amount, and either it is the whole
 * message ("$4,500") or a price cue sits right before it ("more like $28k",
 * "cóbrale unos $3,700") or "total" right after it. Never a cost the
 * contractor pays ("my plumber quoted $2,800"), a deposit or a percentage, or
 * one of several amounts. Null otherwise.
 */
export function statedPriceCents(t: string): number | null {
  const s = (t ?? "").normalize("NFC");
  if (!s.trim() || SHARE.test(s)) return null;
  const found = amounts(s);
  if (found.length !== 1) return null;
  const a = found[0];
  const before = s.slice(0, a.start);
  const after = s.slice(a.end);
  const bare = !/[\p{L}\d]/u.test(before + after);
  if (bare) return a.cents;
  const clause = before.slice(
    Math.max(
      before.lastIndexOf("."),
      before.lastIndexOf("!"),
      before.lastIndexOf("?"),
      before.lastIndexOf("\n"),
    ) + 1,
  );
  if (COST_BEFORE.test(clause)) return null;
  const near = before.slice(-40).replace(/[\s,;:—–-]+$/u, "").trimEnd();
  const cued = PRICE_BEFORE.test(near) || PRICE_AFTER.test(after);
  return cued ? a.cents : null;
}
