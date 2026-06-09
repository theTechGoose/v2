import { Inject, Injectable } from "#danet/core";
import {
  LLM_CLIENT,
  type LLMClient,
} from "@agents/domain/business/llm/base/mod.ts";
import { type Lang, t } from "@core/i18n/mod.ts";

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
    const multiLangLine =
      `\n\nOUTPUT STRUCTURE OVERRIDE: return JSON { "options": [ { "byLang": { ${
        langs.map((l) => `"${l}": { "jobName": "...", "summary": "...", "bullets": ["...", "..."] }`).join(", ")
      } } }, ... ] } — exactly these language keys: ${langList}. Within an option, the bullets in each language MUST be 1:1 translations of the same scope (same count and order). jobName/summary/bullets follow all the rules above, in each language.`;

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
      });
      text = res.text ?? "";
    } catch (err) {
      console.error("[generate-job-options] llm call failed:", err);
      return { options: fallbackOptions(raw, langs), langs };
    }

    const parsed = tryParseJson(text);
    const options = normalizeOptions(parsed?.options, langs, primary);
    if (options.length > 0) return { options, langs };
    return { options: fallbackOptions(raw, langs), langs };
  }
}

function normalizeOneLang(o: unknown): JobOptionLang | null {
  const obj = o as { jobName?: unknown; summary?: unknown; bullets?: unknown };
  const bullets = Array.isArray(obj?.bullets)
    ? obj.bullets
      .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
      .map((b) => b.trim().replace(/\s+/g, " ").replace(/[.;]+$/, ""))
      .slice(0, 4)
    : [];
  if (bullets.length === 0) return null;
  const summary = typeof obj?.summary === "string" && obj.summary.trim()
    ? clampSummary(obj.summary)
    : clampSummary(bullets[0]);
  const jobName = typeof obj?.jobName === "string" && obj.jobName.trim()
    ? clampJobName(obj.jobName)
    : deriveJobName(summary);
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
    );
    if (!primaryLang) continue;
    for (const l of langs) {
      byLang[l] = normalizeOneLang((src as Record<string, unknown>)?.[l]) ??
        primaryLang;
    }
    // Disambiguate duplicate primary jobNames across the option set.
    const unique = disambiguate(byLang[primary].jobName, seenNames);
    if (unique !== byLang[primary].jobName) {
      byLang[primary] = { ...byLang[primary], jobName: unique };
    }
    // Flat fields = primary language (back-compat for the picker).
    out.push({ id: `opt${out.length + 1}`, ...byLang[primary], byLang });
  }
  return out;
}

/** Ensure a jobName is unique within the option set; appends " (2)", " (3)"
 *  … on collision. Tracks seen names case-insensitively. */
function disambiguate(name: string, seen: Set<string>): string {
  let unique = name;
  let n = 2;
  while (seen.has(unique.toLowerCase())) {
    unique = `${name} (${n})`;
    n++;
  }
  seen.add(unique.toLowerCase());
  return unique;
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

function clampSummary(s: string): string {
  const cleaned = s.trim().replace(/\s+/g, " ");
  const words = cleaned.split(" ");
  return words.length <= 8 ? cleaned : words.slice(0, 8).join(" ");
}

function clampJobName(s: string): string {
  const cleaned = s.trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(
    /\s+/g,
    " ",
  );
  const words = cleaned.split(" ").filter(Boolean).slice(0, 3);
  return words.map(titleCaseWord).join(" ");
}

function deriveJobName(summary: string): string {
  return clampJobName(summary);
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * Heuristic fallback when the LLM is unavailable or returns garbage.
 * Splits the raw text into bullet-ish lines and produces three light
 * variations (in each requested language) so the picker still functions.
 */
function fallbackOptions(raw: string, langs: Lang[]): JobOption[] {
  const lines = raw
    .split(/[\n.;]+/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter((l) => l.length > 0);
  const base = (lines.length > 0 ? lines : [raw.trim()]).slice(0, 4);

  const perLang = (lang: Lang, variant: 0 | 1 | 2): JobOptionLang => {
    const summary = clampSummary(base[0] || t(lang, "generateJobOptions.newJob"));
    const jobName = deriveJobName(summary);
    const bullets = variant === 0
      ? base
      : variant === 1
      ? base.slice(0, 3)
      : [...base.slice(0, 3), t(lang, "generateJobOptions.jobsiteCleanup")]
        .slice(0, 4);
    return {
      jobName: variant === 0 ? jobName : `${jobName} (${variant + 1})`,
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
