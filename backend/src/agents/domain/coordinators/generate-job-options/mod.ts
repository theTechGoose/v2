import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
  type LLMTurn,
} from "@agents/domain/business/llm/base/mod.ts";
import { type Lang, t } from "@core/i18n/mod.ts";
import { lineLangMismatch } from "#quote-flow/message-language.ts"; // REQ-710
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts"; // REQ-710
import {
  disambiguateTitle,
  type VersionStyle,
  versionTitle,
} from "#quote-flow/version-titles.ts";
import {
  fitJobNameToBudget,
  JOB_NAME_MAX_WORDS,
  summarizeJobName,
} from "#quote-flow/job-name.ts";
import { clampSummary } from "#quote-flow/summary-clamp.ts";
import { namesOptionRole } from "./role-words.ts";
import { scopeBulletsFromRaw } from "#quote-flow/scope-from-raw.ts";
import {
  bulletFor,
  missedTypedItems,
  missingQuantities,
  typedQuantities,
  type TypedQuantity,
  typedScopeItems,
  typedWorkItems,
  withQuantity,
} from "#quote-flow/typed-coverage.ts";
import {
  cleanScopeBullet,
  type CustomerFacts,
  customerFactsFrom,
  dedupeOptionsByBullets,
  distinctScopeIndexes,
  distinctScopeItems,
  groupedBullets,
  labelVersionStyles,
  nearTwinBullets,
  partitionByCoverage,
  stripCustomerDetails,
  widerBullets,
} from "#quote-flow/option-bullets.ts";
import { mentionsMoney } from "#quote-flow/private-cost.ts";
import { dropSelfCorrections } from "#quote-flow/self-correction.ts";
import { ES_TRADE_GLOSSARY } from "@agents/domain/business/es-trade-glossary/mod.ts";

export interface GenerateJobOptionsInput {
  userId: string;
  /** Raw text the contractor typed into the chat box. */
  raw: string;
  /** Optional price (cents) — scope context so options don't promise
   *  more than the price covers. */
  priceCents?: number;
  /**
   * Target languages the options are generated in. The contractor reviews
   * them in their app language and the customer's quote renders in the comms
   * language, so we generate ALL relevant languages up front (= the selected
   * send languages ∪ the app language). Order matters: index 0 is the primary
   * (used as the fallback when a translation is missing). Defaults to ["en"].
   */
  langs?: string[];
  /**
   * REQ-439 (M9): the contractor's own words — the yardstick every option is
   * checked against for typed items and quantities. Defaults to `raw`; a
   * step correction passes the job and the correction, without the
   * request's framing ("The version … the contractor is looking at").
   */
  typed?: string;
}

/** Per-language content for one option. */
export interface JobOptionLang {
  jobName: string;
  summary: string;
  bullets: string[];
}

export interface JobOption extends JobOptionLang {
  /** Stable id ("opt1" | "opt2" | "opt3") used by the picker. */
  id: string;
  // Flat jobName/summary/bullets (inherited from JobOptionLang) carry the
  // PRIMARY language — the contractor's app language — so the picker renders
  // in the contractor's language with no client change.
  /** Option content keyed by language code. Always carries every requested
   *  language (a missing translation falls back to the primary language).
   *  Used to render the customer's quote/agreement in the comms language. */
  byLang: Record<string, JobOptionLang>;
  /** REQ-446 (m13): the role this version plays — concise / standard /
   *  detailed, by how much it says (labelVersionStyles); absent when there
   *  is only one version. The picker card shows it. */
  style?: VersionStyle;
}

export interface GenerateJobOptionsResult {
  options: JobOption[];
  /** The languages each option carries, primary first. */
  langs: string[];
  /** REQ-026 (NW-05): true when the model could not be used (call failed
   *  or unparseable reply) and the options are the heuristic scope bullets
   *  — never the contractor's sentence echoed back. */
  degraded: boolean;
}

const SYSTEM_PROMPT = t("en", "prompts.generateJobOptions");

function normalizeLangs(input?: string[]): Lang[] {
  const out: Lang[] = [];
  for (const l of input ?? []) {
    const v: Lang | null = l === "es" ? "es" : l === "en" ? "en" : null;
    if (v && !out.includes(v)) out.push(v);
  }
  return out.length ? out : ["en"];
}

/**
 * GenerateJobOptions — one-shot LLM pass that turns the contractor's raw
 * chat-box input into three editable scope-of-work options, each provided in
 * every requested language. The assistant's "Job Details" screen shows the
 * contractor's app-language copy; the customer's quote uses the comms-language
 * copy. The user edits bullets and picks one option, whose surviving bullets
 * become the quote description.
 *
 * REQ-400 (demo-loop cycle 2, M21): every option is a version of the WHOLE
 * job. The prompt's output example used to give each option exactly three
 * bullets, and nothing checked the reply, so a nine-item bath gut came back
 * as three "versions" holding a third of the job each. A reply whose options
 * do not each cover the job (partitionByCoverage), or whose most detailed
 * option holds less than half of what the contractor typed, is asked again
 * ONCE with the job's items listed; the better reply is kept. Options that
 * still hold part of the job are dropped, and when none holds all of it the
 * parts are merged into one version that does. m32: bullets never carry the
 * customer's name, their contact or the job's duration (cleanScopeBullet).
 */
@Injectable()
export class GenerateJobOptions {
  constructor(@Inject(LLM_CLIENT) private llm: LLMClient) {}

  async run(input: GenerateJobOptionsInput): Promise<GenerateJobOptionsResult> {
    if (!input.raw.trim()) throw new Error("raw is required");
    // REQ-653 (demo-loop cycle 5, M7): "LVP no wait porcelain tile 12x24" is
    // porcelain tile — the corrected-away word never reaches the model, the
    // fallback or the typed yardstick (every option read "Install LVP and
    // porcelain tile").
    const raw = dropSelfCorrections(input.raw.trim()) || input.raw.trim();

    const langs = normalizeLangs(input.langs);
    const primary = langs[0];

    const priceLine =
      typeof input.priceCents === "number" && input.priceCents > 0
        ? t("en", "prompts.generateJobOptions.priceLine", {
          amount: (input.priceCents / 100).toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          }),
        })
        : "";

    // Ask for every requested language in a single pass so the three options
    // stay aligned (same scope, just translated) across languages.
    const langNames: Record<string, string> = {
      en: "English",
      es: "neutral Latin-American Spanish",
    };
    const langList = langs.map((l) => `"${l}" (${langNames[l]})`).join(", ");
    // REQ-028 (NW-05): one flat object per option keyed by language — the
    // extra "byLang" nesting made gpt-4o-mini emit ONE option carrying three
    // duplicate "byLang" keys (JSON.parse keeps the last → one card). The
    // example spells out all three options; nothing is left to "...".
    // REQ-400 (M21): the bullets example is open-ended — a fixed three-line
    // example made the model split a nine-item job into three thirds.
    const optionShape = `{ ${
      langs.map((l) =>
        `"${l}": { "jobName": "...", "summary": "...", "bullets": ["<scope line>", "…"] }`
      ).join(", ")
    } }`;
    const multiLangLine =
      `\n\nOUTPUT STRUCTURE OVERRIDE: return JSON { "options": [ ${optionShape}, ${optionShape}, ${optionShape} ] } — an ARRAY of exactly 3 option objects; each option object has exactly these language keys: ${langList}. "bullets" has as many lines as the option needs: EVERY option covers the WHOLE job (every scope item, in every option) and the three play distinct roles in this order — 1 CONCISE (fewest lines, related items grouped), 2 STANDARD (one line per item), 3 DETAILED (one line per item with every specific the contractor stated: quantities, sizes, materials) — never split the job's items across them. No bullet names the customer, their contact or the job's duration. Within an option, the bullets in each language MUST be 1:1 translations of the same scope (same count and order). jobName/summary/bullets follow all the rules above, in each language. jobName and summary never name the option's role: they describe the job itself ("Kitchen Remodel"), never "Concise", "Standard", "Detailed" or "Scope of work" (es: "conciso", "estándar", "detallado", "alcance de trabajo").` +
      // REQ-448 (demo-loop cycle 3, m47): the Spanish picker copy read
      // "gabinetes de shaker" and "sq ft" — it had no glossary.
      (langs.includes("es") ? ` ${ES_TRADE_GLOSSARY}` : "");

    // REQ-400 (m32): the customer the message names — never a bullet.
    const facts = customerFactsFrom(raw);
    const ask: LLMTurn = {
      role: "user",
      content: `${
        t("en", "prompts.generateJobOptions.userPrefix", { raw })
      }${priceLine}${multiLangLine}`,
    };

    let text: string;
    try {
      const res = await this.llm.respond({
        systemPrompt: SYSTEM_PROMPT,
        messages: [ask],
        userId: input.userId,
        responseFormat: "json",
      });
      text = res.text ?? "";
    } catch (err) {
      console.error("[generate-job-options] llm call failed:", err);
      return {
        options: fallbackOptions(raw, langs, facts),
        langs,
        degraded: true,
      };
    }

    let options = normalizeOptions(
      tryParseJson(text)?.options,
      langs,
      primary,
      facts,
    );
    if (options.length === 0) {
      // REQ-026: a degraded answer must be diagnosable — say what came back.
      console.warn(
        "[generate-job-options] reply not usable, using honest fallback:",
        JSON.stringify(text.slice(0, 400)),
      );
      return {
        options: fallbackOptions(raw, langs, facts),
        langs,
        degraded: true,
      };
    }

    // REQ-400 (M21): every option must be the whole job. When none is — or
    // the most detailed one holds less than half of what was typed — ask
    // once more with the job's items listed, and keep the better reply.
    // REQ-439 (M9): and what the contractor TYPED is the yardstick too — a
    // reply whose options leave out a typed item or quantity is asked again
    // with them listed.
    const typedText = input.typed?.trim()
      ? dropSelfCorrections(input.typed.trim()) || input.typed.trim()
      : raw;
    const typedFacts = input.typed ? customerFactsFrom(typedText) : facts;
    const typed = typedScopeItems(typedText, primary, typedFacts);
    const yardstick: Yardstick = {
      typed,
      work: typedWorkItems(typedText, primary, typedFacts),
      quantities: typedQuantities(typedText, primary, typedFacts),
    };
    let verdict = coverageVerdict(options, yardstick);
    if (verdict.score < 2) {
      const split = verdict.complete.length === 0 || verdict.shortOfTyped;
      const items = distinctScopeItems([
        ...options.flatMap((o) => o.bullets),
        ...(verdict.shortOfTyped ? typed : []),
      ]);
      console.warn(
        `[generate-job-options] options do not each cover the job (${verdict.complete.length}/${options.length} whole, ${verdict.detail} of ${typed.length} typed items, missing ${
          JSON.stringify([
            ...verdict.missedItems,
            ...verdict.missedQuantities.map((q) => q.text),
          ])
        }) — asking again:`,
        JSON.stringify(text.slice(0, 600)),
      );
      const retryAsk = [
        split
          ? t("en", "prompts.generateJobOptions.coverageRetry", {
            items: items.map((i) => `- ${i}`).join("\n"),
          })
          : "",
        verdict.gaps > 0
          ? t("en", "prompts.generateJobOptions.typedRetry", {
            items: [
              ...verdict.missedItems,
              ...verdict.missedQuantities
                .filter((q) => !verdict.missedItems.includes(q.item))
                .map((q) =>
                  q.text === q.item ? q.text : `${q.text} (${q.item})`
                ),
            ].map((i) => `- ${i}`).join("\n"),
          })
          : "",
      ].filter(Boolean).join("\n\n");
      try {
        const again = await this.llm.respond({
          systemPrompt: SYSTEM_PROMPT,
          messages: [ask, { role: "assistant", content: text }, {
            role: "user",
            content: retryAsk,
          }],
          userId: input.userId,
          responseFormat: "json",
        });
        const retried = normalizeOptions(
          tryParseJson(again.text ?? "")?.options,
          langs,
          primary,
          facts,
        );
        const retriedVerdict = retried.length
          ? coverageVerdict(retried, yardstick)
          : null;
        if (retriedVerdict && better(retriedVerdict, verdict)) {
          options = retried;
          verdict = retriedVerdict;
        }
      } catch (err) {
        console.error("[generate-job-options] coverage re-ask failed:", err);
      }
    }
    // Parts of the job are never offered as versions of it: keep the whole
    // ones, else merge the parts into one version that holds every item.
    // REQ-439 (M9): a typed quantity the model still left out goes back
    // into the line that names its item, in every option and language.
    const kept =
      (verdict.complete.length > 0
        ? verdict.complete
        : [mergeParts(options, langs)]).map((o) =>
          keepQuantities(o, yardstick.quantities, langs)
        );
    // REQ-710 (demo-loop cycle 5, M4, pair 7): every line in its slot's
    // language — the English version read "Install kitchen backsplash 30
    // pies cuadrados subway tile" (the Spanish glossary applied to English).
    const whole = await inSlotLanguage(kept, langs, this.llm, input.userId);
    if (whole.length < 3) {
      // The picker promises three versions (P-24); a short answer is worth
      // a look in the logs even though it is usable.
      console.warn(
        `[generate-job-options] ${whole.length} whole-job option(s) of ${options.length}:`,
        JSON.stringify(text.slice(0, 600)),
      );
    }
    // REQ-446 (m13): each version says which role it plays.
    return {
      options: labelVersionStyles(padToThree(renumber(whole), langs)),
      langs,
      degraded: false,
    };
  }
}

/**
 * REQ-710 (demo-loop cycle 5, M4, pair 7) — every line of every option in
 * its slot's language. After "add a Spanish version for the homeowner's
 * mom" the ENGLISH version read "Install kitchen backsplash 30 pies
 * cuadrados subway tile", and nothing checked a line against its slot. A
 * job name, summary or bullet written in the other language (lineLangMismatch)
 * is translated into the slot's language — one TranslateBullets call per
 * language, the job names marked as titles. A failed call keeps the lines as
 * they are: a mixed line is better than lost scope.
 */
async function inSlotLanguage(
  options: JobOption[],
  langs: Lang[],
  llm: LLMClient,
  userId: string,
): Promise<JobOption[]> {
  const primary = langs[0];
  // Own copies: a language the model skipped shares the primary's object.
  const out = options.map((o) => ({
    ...o,
    byLang: Object.fromEntries(
      Object.entries(o.byLang).map(([l, v]) => [
        l,
        { ...v, bullets: [...v.bullets] },
      ]),
    ) as Record<string, JobOptionLang>,
  }));
  const translator = new TranslateBullets(llm);
  for (const lang of langs) {
    const hits: Array<
      { v: JobOptionLang; at: "jobName" | "summary" | number }
    > = [];
    for (const o of out) {
      const v = o.byLang[lang];
      if (!v) continue;
      if (lineLangMismatch(v.jobName, lang)) hits.push({ v, at: "jobName" });
      if (lineLangMismatch(v.summary, lang)) hits.push({ v, at: "summary" });
      v.bullets.forEach((b, i) => {
        if (lineLangMismatch(b, lang)) hits.push({ v, at: i });
      });
    }
    if (hits.length === 0) continue;
    const texts = hits.map(({ v, at }) =>
      typeof at === "number" ? v.bullets[at] : v[at]
    );
    const res = await translator.run({
      userId,
      texts,
      from: lang === "es" ? "en" : "es",
      to: lang,
      titleLines: hits.flatMap((h, i) => h.at === "jobName" ? [i] : []),
    });
    if (!res.translated || res.texts.length !== texts.length) {
      console.warn(
        `[generate-job-options] ${hits.length} line(s) not in ${lang} kept as written:`,
        JSON.stringify(texts),
      );
      continue;
    }
    hits.forEach(({ v, at }, i) => {
      const text = res.texts[i];
      if (typeof at === "number") v.bullets[at] = text;
      else if (at === "jobName") v.jobName = clampJobName(text, lang);
      else v.summary = clampSummary(text);
    });
  }
  // The flat fields are the primary language's (the picker reads them).
  return out.map((o) => ({ ...o, ...o.byLang[primary], id: o.id }));
}

/** REQ-400 / REQ-439: what the contractor typed, read three ways. */
interface Yardstick {
  /** Every typed item (REQ-400's count check). */
  typed: string[];
  /** The typed items that are work on the job (REQ-439). */
  work: string[];
  /** The numbers, measurements and quantities they carry (REQ-439). */
  quantities: TypedQuantity[];
}

/** REQ-400 (M21): how well one reply covers the job. */
interface CoverageVerdict {
  /** The options that hold the whole job (partitionByCoverage). */
  complete: JobOption[];
  /** Bullets in the reply's most detailed option. */
  detail: number;
  /** That option holds less than half of the items the contractor typed. */
  shortOfTyped: boolean;
  /** REQ-439 (M9): typed work items that even the best option leaves out. */
  missedItems: string[];
  /** REQ-439 (M9): typed quantities some option leaves out. */
  missedQuantities: TypedQuantity[];
  /** missedItems + missedQuantities. */
  gaps: number;
  /** 2 = whole-job options holding all that was typed, 1 = whole but short
   *  of what was typed, 0 = parts. */
  score: number;
}

/** Everything an option says, in every language — the typed text may be in
 *  a language other than the primary one. */
function optionLines(o: JobOption): string[] {
  return Object.values(o.byLang).flatMap((l) => [
    l.jobName,
    l.summary,
    ...l.bullets,
  ]);
}

function coverageVerdict(
  options: JobOption[],
  yardstick: Yardstick,
): CoverageVerdict {
  const { typed, work, quantities } = yardstick;
  const { complete } = partitionByCoverage(options);
  const detail = Math.max(0, ...options.map((o) => o.bullets.length));
  const shortOfTyped = typed.length >= 6 && detail * 2 < typed.length;
  const pool = complete.length > 0 ? complete : options;
  const missedItems = pool.map((o) => missedTypedItems(optionLines(o), work))
    .reduce((a, b) => (b.length < a.length ? b : a));
  const missedQuantities = quantities.filter((q) =>
    pool.some((o) => missingQuantities(o.bullets, [q]).length > 0)
  );
  const gaps = missedItems.length + missedQuantities.length;
  const score = complete.length === 0 ? 0 : shortOfTyped || gaps > 0 ? 1 : 2;
  return {
    complete,
    detail,
    shortOfTyped,
    missedItems,
    missedQuantities,
    gaps,
    score,
  };
}

function better(a: CoverageVerdict, b: CoverageVerdict): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.gaps !== b.gaps) return a.gaps < b.gaps;
  return a.detail > b.detail;
}

/**
 * REQ-439 (M9): every typed quantity in the option. One the model left out
 * goes into the line that names its item (picked on the primary language and
 * used at the same index in every language whose bullets line up), or — when
 * no line names it — becomes its own line in every language.
 */
function keepQuantities(
  option: JobOption,
  quantities: readonly TypedQuantity[],
  langs: Lang[],
): JobOption {
  const primary = langs[0];
  const byLang: Record<string, JobOptionLang> = {};
  for (const [l, v] of Object.entries(option.byLang)) {
    byLang[l] = { ...v, bullets: [...v.bullets] };
  }
  const anchor = byLang[primary] ?? option;
  for (const q of missingQuantities(anchor.bullets, quantities)) {
    const at = bulletFor(anchor.bullets, q);
    for (const v of Object.values(byLang)) {
      if (at < 0) {
        v.bullets.push(q.item);
        continue;
      }
      if (missingQuantities(v.bullets, [q]).length === 0) continue;
      const i = v.bullets.length === anchor.bullets.length
        ? at
        : bulletFor(v.bullets, q);
      if (i >= 0) v.bullets[i] = withQuantity(v.bullets[i], q);
      else v.bullets.push(q.item);
    }
  }
  const main = byLang[primary] ?? { ...option, bullets: anchor.bullets };
  return { ...option, ...main, id: option.id, byLang };
}

/**
 * REQ-400 (M21): no option holds the whole job (the model split it twice) —
 * the parts become ONE version holding every item: each distinct item once,
 * in the reply's order. A language whose bullets line up with the primary's
 * takes the same lines; otherwise its own distinct items.
 */
function mergeParts(options: JobOption[], langs: Lang[]): JobOption {
  const primary = langs[0];
  const lines = (l: Lang) =>
    options.flatMap((o) => (o.byLang[l] ?? o.byLang[primary]).bullets);
  const picked = distinctScopeIndexes(lines(primary));
  const byLang: Record<string, JobOptionLang> = {};
  for (const l of langs) {
    const aligned = options.every((o) =>
      (o.byLang[l] ?? o.byLang[primary]).bullets.length ===
        o.byLang[primary].bullets.length
    );
    const all = lines(l);
    byLang[l] = {
      ...(options[0].byLang[l] ?? options[0].byLang[primary]),
      bullets: aligned ? picked.map((i) => all[i]) : distinctScopeItems(all),
    };
  }
  return { id: "opt1", ...byLang[primary], byLang };
}

/** A prompt-example placeholder echoed back ("...", "…", "<scope line>") —
 *  never real scope. The dev stub echoes the whole prompt, and the
 *  structure example inside it is valid JSON. */
const PLACEHOLDER = /^(?:\.{3}|…|<[^>]*>)$/;

function realText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s && !PLACEHOLDER.test(s) ? s : undefined;
}

/** realText, minus any text that names the option's role (REQ-667). */
function jobDescription(v: unknown): string | undefined {
  const s = realText(v);
  return s && !namesOptionRole(s) ? s : undefined;
}

function normalizeOneLang(
  o: unknown,
  lang: Lang,
  facts: CustomerFacts,
): JobOptionLang | null {
  const obj = o as { jobName?: unknown; summary?: unknown; bullets?: unknown };
  const bullets = Array.isArray(obj?.bullets)
    ? obj.bullets
      .map((b) => realText(b))
      .filter((b): b is string => !!b)
      // REQ-261 (M26): a bullet naming a money amount is a private cost
      // ("Plumber Ray charges $2,800") — never customer job details.
      .filter((b) => !mentionsMoney(b))
      .map((b) => b.replace(/\s+/g, " ").replace(/[.;]+$/, ""))
      // REQ-400 (m32): "Servicio para Ana López", "Cliente: Ana López", her
      // phone, "Duración de 4 semanas" — never a scope line.
      .map((b) => cleanScopeBullet(b, facts))
      .filter((b): b is string => !!b)
    // REQ-330 (M21/M23): NO cap — REQ-266's 12 still cut a fourteen-item gut
    // job (recessed lights, permit, vanity). The prompt groups past twelve.
    : [];
  if (bullets.length === 0) return null;
  // REQ-667 (cycle 5, m49): a summary or jobName that names the option's
  // role ("Concise scope of work") is not a description of the job — the
  // summary falls back to the jobName, the jobName to the summary.
  const jobNameText = jobDescription(obj?.jobName);
  const summaryText = jobDescription(obj?.summary);
  const summary = summaryText
    ? clampSummary(summaryText)
    : realText(obj?.summary) && jobNameText
    ? clampSummary(jobNameText)
    : clampSummary(bullets[0]);
  const jobName = jobNameText
    ? clampJobName(jobNameText, lang)
    : deriveJobName(summary, lang);
  return { jobName, summary, bullets };
}

function normalizeOptions(
  raw: unknown,
  langs: Lang[],
  primary: Lang,
  facts: CustomerFacts,
): JobOption[] {
  if (!Array.isArray(raw)) return [];
  const out: JobOption[] = [];
  const seenNames = new Set<string>();
  for (let i = 0; i < raw.length && out.length < 3; i++) {
    const o = raw[i] as { byLang?: Record<string, unknown> };
    const src = o?.byLang && typeof o.byLang === "object" ? o.byLang : o;
    const byLang: Record<string, JobOptionLang> = {};
    // Primary language first — it anchors the option and backfills any
    // language the model skipped.
    const primaryLang = normalizeOneLang(
      (src as Record<string, unknown>)?.[primary],
      primary,
      facts,
    );
    if (!primaryLang) continue;
    for (const l of langs) {
      byLang[l] =
        normalizeOneLang((src as Record<string, unknown>)?.[l], l, facts) ??
          primaryLang;
    }
    // Disambiguate duplicate primary jobNames across the option set.
    const unique = disambiguate(byLang[primary].jobName, seenNames, primary);
    if (unique !== byLang[primary].jobName) {
      byLang[primary] = { ...byLang[primary], jobName: unique };
    }
    // Flat fields = primary language (back-compat for the picker).
    out.push({ id: `opt${out.length + 1}`, ...byLang[primary], byLang });
  }
  // REQ-330 (p15-7): the model answers a one-item job with three names on
  // the same bullets — collapse equal bullet sets, then renumber the ids.
  return renumber(dedupeOptionsByBullets(out));
}

function renumber(options: JobOption[]): JobOption[] {
  return options.map((o, i) => ({ ...o, id: `opt${i + 1}` }));
}

/** Ensure a jobName is unique within the option set. On collision it takes
 *  a localized version qualifier ("… · Versión breve") — never the old
 *  " (2)" / " (3)" numeric suffix, which read like duplicates of one job
 *  rather than versions of it (P-24). Tracks names case-insensitively. */
function disambiguate(name: string, seen: Set<string>, lang: Lang): string {
  return disambiguateTitle(name, seen, lang);
}

function tryParseJson(s: string): { options?: unknown } | undefined {
  if (!s) return undefined;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : s).trim();
  try {
    return JSON.parse(candidate);
  } catch { /* fall through */ }
  const braceStart = candidate.indexOf("{");
  const braceEnd = candidate.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return JSON.parse(candidate.slice(braceStart, braceEnd + 1));
    } catch { /* swallow */ }
  }
  return undefined;
}

// UX-18: summaries are clamped by the ONE shared helper (visible "…" on
// truncation, never a silent mid-phrase cut) — imported above.

/** UX-05/UX-41: Spanish names are sentence case with lowercase connectors,
 *  never blanket Title Case — the shared lang-aware derivation owns that. */
// REQ-337 (demo p15-1): the hard 3-word slice turned "bedrooms AND hallway"
// into "Bedroom Repaint"; the name now fits the shared word/char budget so
// it can cover every area named ("Bedroom & Hallway Repaint").
function clampJobName(s: string, lang: Lang): string {
  if (lang === "es") {
    return fitJobNameToBudget(
      summarizeJobName(s, "es", { maxWords: JOB_NAME_MAX_WORDS }),
    );
  }
  const cleaned = s.trim().replace(/[^\p{L}\p{N}\s&-]/gu, "").replace(
    /\s+/g,
    " ",
  );
  const words = cleaned.split(" ").filter(Boolean).slice(0, JOB_NAME_MAX_WORDS);
  return fitJobNameToBudget(words.map(titleCaseWord).join(" "));
}

function deriveJobName(summary: string, lang: Lang): string {
  return clampJobName(summary, lang);
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * REQ-028 (P-24): the picker promises three versions. A usable but short
 * model answer (1–2 options) is padded with honest variants of the first
 * option — "· Short version" and "· Wider scope" (+ jobsite cleanup) —
 * exactly the way the heuristic fallback builds its three. REQ-400 (M21):
 * the short version holds EVERY item in fewer lines (groupedBullets); it used
 * to drop the last line, i.e. be part of the job.
 * REQ-330 (p15-7): a variant whose bullets equal an option already on the
 * list is skipped — a one-bullet job gets one or two cards, never two alike.
 * REQ-584 (cycle 4, p4-p1d): a variant that is a NEAR-twin of an option on
 * the list (nearTwinBullets — the short version is the same words regrouped,
 * the wider one often only "+ Jobsite cleanup") is skipped too, and a
 * one-item job is not padded at all: its variants can only differ by a word.
 */
function padToThree(options: JobOption[], langs: Lang[]): JobOption[] {
  if (options.length >= 3) return options;
  const primary = langs[0];
  const base = options[0];
  if (!base || base.bullets.length <= 1) return options;
  const variants: Array<"short" | "wider"> = ["short", "wider"];
  const out = [...options];
  const seen = new Set(out.map((o) => o.jobName.toLowerCase()));
  for (const variant of variants) {
    if (out.length >= 3) break;
    const byLang: Record<string, JobOptionLang> = {};
    for (const l of langs) {
      const src = base.byLang[l] ?? base.byLang[primary];
      const bullets = variant === "short"
        ? groupedBullets(src.bullets)
        : widerBullets(src.bullets, t(l, "generateJobOptions.jobsiteCleanup"));
      byLang[l] = {
        jobName: versionTitle(src.jobName, variant, l),
        summary: src.summary,
        bullets,
      };
    }
    if (out.some((o) => nearTwinBullets(o.bullets, byLang[primary].bullets))) {
      continue;
    }
    let name = byLang[primary].jobName;
    if (seen.has(name.toLowerCase())) {
      name = disambiguateTitle(name, seen, primary);
      byLang[primary] = { ...byLang[primary], jobName: name };
    }
    seen.add(name.toLowerCase());
    out.push({ id: `opt${out.length + 1}`, ...byLang[primary], byLang });
  }
  return out;
}

/**
 * Heuristic fallback when the LLM is unavailable or returns garbage.
 * REQ-026 (NW-05): the bullets are honest scope lines derived from the raw
 * text — intent opener ("I need to"), price clause ("for $500") and pricing
 * question stripped — never the sentence echoed back (which also titled the
 * cards "I Need To"). When nothing scope-like survives, the one bullet is the
 * localized "New job". Three light variations per requested language keep the
 * picker functional. REQ-400: each variation is the whole job (the short one
 * groups lines, never drops one), and a line keeps its scope but loses the
 * customer's name, phone, e-mail and a ", 4 semanas" part (m32).
 */
function fallbackOptions(
  raw: string,
  langs: Lang[],
  facts: CustomerFacts,
): JobOption[] {
  const scoped = scopeBulletsFromRaw(raw, langs[0]);
  // REQ-330: every typed line survives — no cap.
  const lines = scoped.degraded ? [] : scoped.bullets
    .map((line) => stripCustomerDetails(line, facts))
    .filter((line): line is string => !!line);
  const scopeBase = lines.length > 0 ? lines : null;

  const perLang = (lang: Lang, variant: 0 | 1 | 2): JobOptionLang => {
    const base = scopeBase ?? [t(lang, "generateJobOptions.newJob")];
    const summary = clampSummary(base[0]);
    const jobName = deriveJobName(summary, lang);
    const bullets = variant === 0
      ? base
      : variant === 1
      ? groupedBullets(base)
      : widerBullets(base, t(lang, "generateJobOptions.jobsiteCleanup"));
    // P-24: the three fallback variants get honest, localized qualifiers
    // ("· Versión breve" / "· Alcance ampliado") instead of "(2)" / "(3)",
    // which read as duplicates rather than versions.
    return {
      jobName: versionTitle(
        jobName,
        variant === 0 ? "full" : variant === 1 ? "short" : "wider",
        lang,
      ),
      summary,
      bullets,
    };
  };

  const primary = langs[0];
  // REQ-330 (p15-7): a one-line job makes the "short" variant equal to the
  // full one — equal bullet sets collapse, so the picker never shows two
  // cards with the same scope. REQ-584: exact only — this degraded path's
  // titled versions are the same scope by design.
  return renumber(dedupeOptionsByBullets(
    ([0, 1, 2] as const).map((variant) => {
      const byLang: Record<string, JobOptionLang> = {};
      for (const l of langs) byLang[l] = perLang(l, variant);
      return { id: `opt${variant + 1}`, ...byLang[primary], byLang };
    }),
    { exact: true },
  ));
}
