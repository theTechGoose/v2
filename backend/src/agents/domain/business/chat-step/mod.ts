/**
 * REQ-392 (demo-loop cycle 2, M7) — the pure rules behind a message typed in
 * the compact "Tell the assistant…" box on a guided step (the box itself and
 * the step hint are shared/quote-flow/step-composer.ts).
 *
 *   stepScopeText       — what the pricing engine reads beside the job on a
 *                         Pick-a-price correction (the correction rides with the
 *                         confirmed scope, never in the job text, whose amounts
 *                         are the cost floor)
 *   stepJobOptionsRaw   — what the job-options engine rewrites on a Job-details
 *                         correction: the job, the version on screen, the
 *                         correction
 *   stepContextLine     — the line the chat model reads on a wizard question /
 *                         the Ready-to-send review
 *   stepTools           — the review may also revise a line (revise_quote)
 *   isFallbackPricing   — the pricing engine answered with its generic tiers
 *                         (the model was unreachable or answered junk), which
 *                         must never replace the tiers on screen
 *   priceStepReply / jobOptionsStepReply — the server's own reply on the two
 *                         pre-quote steps, in the contractor's language
 *   stepLangs           — the languages the rewritten versions carry
 *
 * REQ-444 (demo-loop cycle 3, M21) — on Pick a price "does this include the
 * quartz slab material or just labor?? … add permit if not" was re-priced and
 * answered with a template; nobody read the question:
 *
 *   priceStepIntent     — a question or a change to the job goes to the chat
 *                         model; only a price correction re-prices
 *   priceStepContext    — what that model answers from: the job, the details
 *                         and the tiers on screen, and what the tiers include
 *
 * REQ-585 (demo-loop cycle 4, M4) — on the start-date card pair 7 got an
 * answer to the Pick-a-price request she had made two steps earlier:
 *
 *   appliedStepTurnIds  — the earlier step turns whose request was applied,
 *                         and their replies, left out of the chat model's
 *                         history so it never re-issues them
 */
import { type Lang, t } from "@core/i18n/mod.ts";
import {
  type ChatStepHint,
  statedPriceCents,
} from "#quote-flow/step-composer.ts";
import type { LLMToolName } from "@agents/domain/business/llm/base/mod.ts";
import { requestedLangs } from "@agents/domain/business/requested-langs/mod.ts";
import { ES_TRADE_GLOSSARY } from "@agents/domain/business/es-trade-glossary/mod.ts";

/** "$28,000" — cents only when there are any ("$1,850.50"). */
export function stepMoney(cents: number): string {
  const dollars = cents / 100;
  return "$" + dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function correctionLine(correction: string): string {
  return t("en", "prompts.chatStep.correction", { text: correction.trim() });
}

/** The confirmed scope with the correction under it — SuggestPrices' `scope`.
 *  No confirmed scope: the correction alone. */
export function stepScopeText(
  scope: string | undefined,
  correction: string,
): string {
  const s = scope?.trim() ?? "";
  return s
    ? `${s}\n\n${correctionLine(correction)}`
    : correctionLine(correction);
}

/** The job, the version on screen, then the correction — GenerateJobOptions'
 *  `raw`. */
export function stepJobOptionsRaw(
  job: string,
  scope: string | undefined,
  correction: string,
): string {
  const parts = [job.trim()];
  const shown = scope?.trim();
  if (shown) {
    parts.push(t("en", "prompts.chatStep.onScreen", { scope: shown }));
  }
  parts.push(correctionLine(correction));
  return parts.filter(Boolean).join("\n\n");
}

/** The line the chat model reads beside the quote. Only the wizard question
 *  and the review steer the model; the pre-quote steps never reach it. */
export function stepContextLine(
  hint: ChatStepHint | undefined,
  opts: { question?: string } = {},
): string | undefined {
  if (hint?.id === "wizard") {
    const question = opts.question?.trim() || hint.wizardStepId || "terms";
    return t("en", "prompts.chatStep.wizard", { question });
  }
  // REQ-448 (demo-loop cycle 3, m47): the review is where update_job_details
  // rewrites the Spanish job details ("trinchado" for trench) — it carries the
  // shared trade glossary.
  if (hint?.id === "review") {
    return `${t("en", "prompts.chatStep.review")} ${ES_TRADE_GLOSSARY}`;
  }
  return undefined;
}

/** The tools the model may call: on the Ready-to-send review a line already
 *  on the quote can be repriced or reworded (revise_quote) besides what the
 *  phase allows. Every other turn keeps exactly the tools it had. */
export function stepTools(
  base: readonly LLMToolName[],
  hint: ChatStepHint | undefined,
): LLMToolName[] {
  const tools = [...base];
  if (hint?.id === "review" && !tools.includes("revise_quote")) {
    tools.push("revise_quote");
  }
  return tools;
}

/** An outcome on a reply that changed something (a question asked back —
 *  "which customer?", "how much?" — changed nothing). */
const LANDED: Record<string, ReadonlySet<string>> = {
  changeOrder: new Set(["change_order", "pending_revision", "draft_updated"]),
  quoteRevision: new Set(["pending_revision", "draft_updated"]),
  changeOrderEdit: new Set(["updated", "withdrawn"]),
};

/** REQ-585: the reply applied the step turn before it — a step reply (it
 *  carries the step: re-priced tiers, rewritten versions), the quote re-read
 *  (`quoteUpdated`), a line / change-order outcome that landed, or terms set
 *  (`termsChanged`). */
function appliedReply(payload: unknown): boolean {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (p.step || p.quoteUpdated || p.termsChanged) return true;
  return Object.entries(LANDED).some(([key, kinds]) => {
    const kind = (p[key] as { kind?: unknown } | undefined)?.kind;
    return typeof kind === "string" && kinds.has(kind);
  });
}

/**
 * REQ-585 (demo-loop cycle 4, M4) — the ids to leave out of the chat model's
 * history: every earlier step-tagged user turn (typed in the compact box on a
 * guided step) whose request a reply applied, with those replies. On the
 * start-date card pair 7's "we start monday nov 23…" was answered with her
 * old Pick-a-price request ("take out the floor stays line") — gpt-4o-mini
 * re-issued it from the history (fleet-6 stdout:226). Untagged turns, cards,
 * wizard picks, turns answered with a question and `currentId` all stay.
 */
export function appliedStepTurnIds(
  history: readonly {
    id: string;
    role: string;
    kind: string;
    payload?: unknown;
  }[],
  currentId: string,
): Set<string> {
  const out = new Set<string>();
  history.forEach((m, i) => {
    if (m.id === currentId || m.role !== "user" || m.kind !== "text") return;
    if (!(m.payload as { step?: unknown } | undefined)?.step) return;
    const replies: string[] = [];
    let applied = false;
    for (const r of history.slice(i + 1)) {
      if (r.role === "user") break;
      if (r.role !== "assistant" || r.kind !== "text") continue;
      replies.push(r.id);
      applied ||= appliedReply(r.payload);
    }
    if (!applied) return;
    out.add(m.id);
    for (const id of replies) out.add(id);
  });
  return out;
}

/** The tiers' rationale lines the pricing engine writes on its generic answer
 *  (SuggestPrices' fallbackTiers) — in either language, since a floor lift
 *  rescales the prices but keeps the lines. */
const FALLBACK_RATIONALE: Record<string, string[]> = Object.fromEntries(
  (["competitive", "market", "premium"] as const).map((tier) => [
    tier,
    (["en", "es"] as const).map((l) =>
      t(l, `suggestPrices.fallback.${tier}Rationale`)
    ),
  ]),
);

/** True when every tier is the pricing engine's generic one: it could not
 *  price this job (model unreachable or junk), so the answer says nothing
 *  about the correction and must not stand in for the tiers on screen. */
export function isFallbackPricing(
  options: readonly { tier?: string; rationale?: string }[],
): boolean {
  return options.length > 0 &&
    options.every((o) =>
      (FALLBACK_RATIONALE[o.tier ?? ""] ?? []).includes(o.rationale ?? "")
    );
}

export interface PriceStepReplyInput {
  /** The tier cards are on screen (help me price it). */
  tiers: boolean;
  /** The re-priced tiers, when the pricing engine ran. */
  options?: {
    tier?: string;
    label: string;
    priceCents: number;
    rationale?: string;
  }[];
  /** The one price the correction named, for the price box. */
  statedCents?: number | null;
}

/** "Re-priced with your note — Competitive $24,500 · Market $28,000 ·
 *  Premium $32,000. I put $28,000 in the price box — …" — or, when the
 *  engine could only answer its generic tiers, that it couldn't re-price
 *  (the tiers on screen stay; REQ-026 honest fallback). */
export function priceStepReply(lang: Lang, input: PriceStepReplyInput): string {
  const out: string[] = [];
  const stated = typeof input.statedCents === "number" && input.statedCents > 0
    ? input.statedCents
    : null;
  if (input.tiers) {
    const priced = input.options?.length && !isFallbackPricing(input.options)
      ? input.options
      : undefined;
    if (priced) {
      const tiers = priced
        .map((o) => `${o.label} ${stepMoney(o.priceCents)}`)
        .join(" · ");
      out.push(t(lang, "chatCoordinator.step.repriced", { tiers }));
    } else {
      out.push(t(lang, "chatCoordinator.step.repriceFailed"));
      if (stated === null) {
        out.push(t(lang, "chatCoordinator.step.priceAskTiers"));
      }
    }
  }
  if (stated !== null) {
    out.push(
      t(
        lang,
        input.tiers
          ? "chatCoordinator.step.priceSetTiers"
          : "chatCoordinator.step.priceSet",
        { amount: stepMoney(stated) },
      ),
    );
  }
  if (out.length === 0) out.push(t(lang, "chatCoordinator.step.priceAsk"));
  return out.join(" ");
}

/** The reply over the rewritten versions — honest when the writer was not
 *  reachable and the versions on screen were left as they were (REQ-026). */
export function jobOptionsStepReply(lang: Lang, degraded: boolean): string {
  return t(
    lang,
    degraded
      ? "chatCoordinator.step.jobOptionsDegraded"
      : "chatCoordinator.step.jobOptions",
  );
}

/** The app language (the contractor reviews in it), the comms languages (the
 *  customer's copy) and any language the text asks for — deduped, app first.
 *  The job-details controller's targetLangs rule, minus the store read. */
export function stepLangs(
  appLang: string,
  comms: readonly string[],
  raw: string,
): ("en" | "es")[] {
  const out: ("en" | "es")[] = [];
  for (const l of [appLang, ...comms, ...requestedLangs(raw)]) {
    const v = l === "es" ? "es" : "en";
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// REQ-444 (demo-loop cycle 3, M21) — a question or a change to the job typed
// on Pick a price
// ---------------------------------------------------------------------------

/** Where a clause starts: the message's start, after a sentence or clause
 *  mark, or after a connector ("and", "also", "but", "please", "can you",
 *  "y", "también", "pero", "puedes"). "¿" is not one: "¿incluye …?" asks. */
const CLAUSE = String
  .raw`(?:^|[.!?;:,\n—–]\s*|\s-\s+|(?<![\p{L}\d])(?:and|also|then|but|please|pls|so|(?:can|could|would|will)\s+you(?:\s+please)?|y|tambi[eé]n|adem[aá]s|pero|luego|por\s+favor|pued(?:es|e|en))\s+)`;

/** A verb that changes what the job covers — add, include, remove — in
 *  English or Spanish (with its clitic forms: "agrégalo", "quítalo"). */
const CHANGE_VERB = String
  .raw`(?:add(?:ing)?|include|put\s+in|throw\s+in|remove|take\s+(?:out|off)|delete|scratch|agr[eé]g\p{L}*|a[ñn][aá]d\p{L}*|incl[uú](?:y\p{L}*|ir)|s[uú]m(?:a|ar|ale|alo|e)|qu[ií]t\p{L}*|s[aá]c(?:a|ar|alo|ala|alos|alas|ale|en)|elimin\p{L}*|borr\p{L}*)(?![\p{L}\d])`;

const SCOPE_CHANGE = new RegExp(`${CLAUSE}${CHANGE_VERB}`, "iu");

/** "you forgot the permit", "the permit is missing", "falta el permiso". */
const MISSING =
  /(?<![\p{L}\d])(?:missing|forgot|forgotten|left\s+(?:out|off)|leave\s+(?:out|off)|don['’]?t\s+forget|falta(?:n|ba|r[ií]a)?|falt[oó]|olvid\p{L}*)(?![\p{L}\d])/iu;

/** A question with no mark: an interrogative opener. Only the accented
 *  Spanish forms — "como 18 mil" and "que sea $3,700" are prices, not asks —
 *  and never "do" / "should", which open corrections ("should be $28k"). */
const QUESTION_OPENER =
  /^\s*(?:(?:and|so|but|also|ok(?:ay)?|hey|y|pero|oye|entonces)[\s,]+)?(?:is|are|isn['’]?t|aren['’]?t|does|doesn['’]?t|did|didn['’]?t|(?:can|could|would|will)\s+(?:you|we|i|it|this|that|they)|what['’]?s|whats|what|how|why|which|who|where|when|qué|cu[aá]nt[oa]s?|cu[aá]l(?:es)?|cómo|por\s*qué|dónde|cuándo|hay)(?![\p{L}\d])/iu;

/** REQ-658 (demo-loop cycle 5, m51): asks how a price breaks down — "break
 *  down labor vs materials", "how did you get 17,500", "explain the premium
 *  tier", "desglosa mano de obra y materiales". */
const BREAKDOWN =
  /(?<![\p{L}\d])(?:break\s*-?\s*(?:it\s+|that\s+|this\s+|them\s+)?down|breakdown|explain|how\s+(?:did|do|would)\s+you\s+(?:get|come\s+up\s+with|arrive|figure|calculate)|how['’]?d\s+you\s+(?:get|come\s+up\s+with|arrive|figure|calculate)|desglos\p{L}*|expl[ií]ca\p{L}*|c[oó]mo\s+(?:llegaste|calculaste|sacaste))(?![\p{L}\d])|(?<![\p{L}\d])(?:labou?r|mano\s+de\s+obra)\s*(?:vs\.?|versus|and|&|\+|\/|y|contra|o)\s*(?:the\s+|los\s+)?(?:materials?|materiales)(?![\p{L}\d])/iu;

/** The message asks how the price breaks down (labor vs materials, how a
 *  tier was reached) — answered by the chat model, never re-priced. */
export function asksForBreakdown(text: string): boolean {
  return BREAKDOWN.test((text ?? "").normalize("NFC"));
}

export interface PriceStepIntent {
  /** "ask": the chat model answers (and may change the job details on
   *  screen); "reprice": the pricing engine re-prices with the correction. */
  route: "ask" | "reprice";
  /** The message asks to add / include / remove an item of the job. */
  scopeChange: boolean;
  /** The one price it names for the WHOLE job, for the price box — never the
   *  price of an item it adds ("add the permit, it's $450"). */
  statedCents: number | null;
}

function firstMatch(s: string, res: readonly RegExp[]): number {
  let at = -1;
  for (const re of res) {
    const m = re.exec(s);
    if (m && (at < 0 || m.index < at)) at = m.index;
  }
  return at;
}

/**
 * What a text typed on Pick a price is (REQ-444). A change to the job ("add
 * permit if not", "agrega el permiso", "remove the vanity", "you forgot the
 * permit") or a question ("?", "¿…?", "is X included", "what does … cover")
 * goes to the chat model — with the tiers in context it answers, and it can
 * rewrite the job details on screen. Only a price correction ("no, it's the
 * whole gut job — more like $28k") re-prices (REQ-392). A price named before
 * the change is the job's; an amount after it is the added item's and never
 * fills the price box.
 */
export function priceStepIntent(text: string): PriceStepIntent {
  const s = (text ?? "").normalize("NFC");
  if (!s.trim()) {
    return { route: "reprice", scopeChange: false, statedCents: null };
  }
  const change = firstMatch(s, [SCOPE_CHANGE, MISSING]);
  if (change >= 0) {
    return {
      route: "ask",
      scopeChange: true,
      statedCents: statedPriceCents(s.slice(0, change)),
    };
  }
  const asks = /[?¿]/.test(s) || QUESTION_OPENER.test(s) ||
    asksForBreakdown(s);
  return {
    route: asks ? "ask" : "reprice",
    scopeChange: false,
    statedCents: statedPriceCents(s),
  };
}

export interface PriceStepContextInput {
  /** The job as the contractor typed it. */
  job: string;
  /** The job details on screen (the confirmed bullets); none → the job. */
  scope?: string;
  /** The language the details on screen are written in (the app's). */
  lang: Lang;
  /** The tiers on screen; none → "I know my price" (no suggestions). */
  options?: readonly {
    label: string;
    priceCents: number;
    rationale?: string;
  }[];
  /** What the tiers include. */
  basis?: string;
  /** The price the message named for the job (now in the price box). */
  statedCents?: number | null;
  /** REQ-658: the message asks how the price breaks down. */
  breakdown?: boolean;
}

/** The business context the chat model answers a Pick-a-price question
 *  from (REQ-444): the step, the job, the details and the tiers on screen,
 *  what the tiers include, and a price the message put in the box. */
export function priceStepContext(input: PriceStepContextInput): string {
  const job = input.job.trim();
  const shown = input.scope?.trim() || job;
  const out = [
    "Step: Pick a price — no quote exists yet; the contractor picks or types the price on this screen.",
    `The job as the contractor typed it:\n${job || "(not given)"}`,
    `The job details on screen (${input.lang}):\n${shown || "(none)"}`,
  ];
  if (input.options?.length) {
    out.push(
      `The prices on screen: ${
        input.options.map((o) =>
          `${o.label} ${stepMoney(o.priceCents)}${
            o.rationale?.trim() ? ` (${o.rationale.trim()})` : ""
          }`
        ).join(" · ")
      }`,
    );
    out.push(
      `What these prices include: ${
        t(
          "en",
          input.basis === "labor_materials_as_noted"
            ? "suggestPrices.basis.laborMaterialsAsNoted"
            : "suggestPrices.basis.laborAndMaterials",
        )
      }`,
    );
  } else {
    out.push(
      "No suggested prices are on screen — the contractor types their own price.",
    );
  }
  if (typeof input.statedCents === "number" && input.statedCents > 0) {
    out.push(
      `Their message names ${
        stepMoney(input.statedCents)
      } for the whole job — that amount is now in the price box.`,
    );
  }
  // REQ-658 (demo-loop cycle 5, m51): "break down labor vs materials" — the
  // model explains the split with the contractor's own numbers.
  if (input.breakdown) {
    out.push(
      'They asked how the price breaks down. Answer with a split of the price they asked about (else each price on screen) into labor and materials, from the job details on screen. When their message gives an hourly rate (like "85/hr") or a markup on materials (like "cost+15%"), use it: labor = estimated hours × their hourly rate; materials = estimated material cost plus their markup. Say the hours and costs are estimates. Explaining the split is allowed — the prices on screen do not change.',
    );
  }
  return out.join("\n\n");
}
