import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";
import { type Lang, t } from "@core/i18n/mod.ts";
import { disambiguateTitle, versionTitle } from "#quote-flow/version-titles.ts";
import { summarizeJobName } from "#quote-flow/job-name.ts";
import { clampSummary } from "#quote-flow/summary-clamp.ts";
import { scopeBulletsFromRaw } from "#quote-flow/scope-from-raw.ts";

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
 */
@Injectable()
export class GenerateJobOptions {
  constructor(@Inject(LLM_CLIENT) private llm: LLMClient) {}

  async run(input: GenerateJobOptionsInput): Promise<GenerateJobOptionsResult> {
    const raw = input.raw.trim();
    if (!raw) throw new Error("raw is required");

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
    const optionShape = `{ ${
      langs.map((l) =>
        `"${l}": { "jobName": "...", "summary": "...", "bullets": ["...", "...", "..."] }`
      ).join(", ")
    } }`;
    const multiLangLine =
      `\n\nOUTPUT STRUCTURE OVERRIDE: return JSON { "options": [ ${optionShape}, ${optionShape}, ${optionShape} ] } — an ARRAY of exactly 3 option objects; each option object has exactly these language keys: ${langList}. Within an option, the bullets in each language MUST be 1:1 translations of the same scope (same count and order). jobName/summary/bullets follow all the rules above, in each language.`;

    let text: string;
    try {
      const res = await this.llm.respond({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `${
            t("en", "prompts.generateJobOptions.userPrefix", { raw })
          }${priceLine}${multiLangLine}`,
        }],
        userId: input.userId,
        responseFormat: "json",
      });
      text = res.text ?? "";
    } catch (err) {
      console.error("[generate-job-options] llm call failed:", err);
      return { options: fallbackOptions(raw, langs), langs, degraded: true };
    }

    const parsed = tryParseJson(text);
    const options = normalizeOptions(parsed?.options, langs, primary);
    if (options.length > 0 && options.length < 3) {
      // The picker promises three versions (P-24); a short answer is worth
      // a look in the logs even though it is usable.
      console.warn(
        `[generate-job-options] model returned ${options.length} option(s):`,
        JSON.stringify(text.slice(0, 600)),
      );
    }
    if (options.length > 0) {
      return { options: padToThree(options, langs), langs, degraded: false };
    }
    // REQ-026: a degraded answer must be diagnosable — say what came back.
    console.warn(
      "[generate-job-options] reply not usable, using honest fallback:",
      JSON.stringify(text.slice(0, 400)),
    );
    return { options: fallbackOptions(raw, langs), langs, degraded: true };
  }
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

function normalizeOneLang(o: unknown, lang: Lang): JobOptionLang | null {
  const obj = o as { jobName?: unknown; summary?: unknown; bullets?: unknown };
  const bullets = Array.isArray(obj?.bullets)
    ? obj.bullets
      .map((b) => realText(b))
      .filter((b): b is string => !!b)
      .map((b) => b.replace(/\s+/g, " ").replace(/[.;]+$/, ""))
      .slice(0, 4)
    : [];
  if (bullets.length === 0) return null;
  const summaryText = realText(obj?.summary);
  const summary = summaryText
    ? clampSummary(summaryText)
    : clampSummary(bullets[0]);
  const jobNameText = realText(obj?.jobName);
  const jobName = jobNameText
    ? clampJobName(jobNameText, lang)
    : deriveJobName(summary, lang);
  return { jobName, summary, bullets };
}

function normalizeOptions(
  raw: unknown,
  langs: Lang[],
  primary: Lang,
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
    );
    if (!primaryLang) continue;
    for (const l of langs) {
      byLang[l] = normalizeOneLang((src as Record<string, unknown>)?.[l], l) ??
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
  return out;
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
function clampJobName(s: string, lang: Lang): string {
  if (lang === "es") return summarizeJobName(s, "es");
  const cleaned = s.trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(
    /\s+/g,
    " ",
  );
  const words = cleaned.split(" ").filter(Boolean).slice(0, 3);
  return words.map(titleCaseWord).join(" ");
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
 * option — "· Short version" (fewer bullets) and "· Wider scope" (+ jobsite
 * cleanup) — exactly the way the heuristic fallback builds its three.
 */
function padToThree(options: JobOption[], langs: Lang[]): JobOption[] {
  if (options.length >= 3) return options;
  const primary = langs[0];
  const base = options[0];
  const variants: Array<"short" | "wider"> = ["short", "wider"];
  const out = [...options];
  const seen = new Set(out.map((o) => o.jobName.toLowerCase()));
  for (const variant of variants) {
    if (out.length >= 3) break;
    const byLang: Record<string, JobOptionLang> = {};
    for (const l of langs) {
      const src = base.byLang[l] ?? base.byLang[primary];
      const bullets = variant === "short"
        ? src.bullets.slice(0, Math.max(1, src.bullets.length - 1))
        : [...src.bullets.slice(0, 3), t(l, "generateJobOptions.jobsiteCleanup")]
          .slice(0, 4);
      byLang[l] = {
        jobName: versionTitle(src.jobName, variant, l),
        summary: src.summary,
        bullets,
      };
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
 * picker functional.
 */
function fallbackOptions(raw: string, langs: Lang[]): JobOption[] {
  const scoped = scopeBulletsFromRaw(raw, langs[0]);
  const scopeBase = scoped.degraded ? null : scoped.bullets.slice(0, 4);

  const perLang = (lang: Lang, variant: 0 | 1 | 2): JobOptionLang => {
    const base = scopeBase ?? [t(lang, "generateJobOptions.newJob")];
    const summary = clampSummary(base[0]);
    const jobName = deriveJobName(summary, lang);
    const bullets = variant === 0
      ? base
      : variant === 1
      ? base.slice(0, 3)
      : [...base.slice(0, 3), t(lang, "generateJobOptions.jobsiteCleanup")]
        .slice(0, 4);
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
  return ([0, 1, 2] as const).map((variant) => {
    const byLang: Record<string, JobOptionLang> = {};
    for (const l of langs) byLang[l] = perLang(l, variant);
    return { id: `opt${variant + 1}`, ...byLang[primary], byLang };
  });
}
