/**
 * Job Name — the short human label for a job, used consistently across the
 * platform (quote heading, chat card, email subject, SMS body, contract hero).
 *
 * REQ-337 (demo m6 / p15-1): the deterministic derivation yields ≤3 words;
 * a model-supplied name may run to JOB_NAME_MAX_WORDS / JOB_NAME_MAX_CHARS
 * so it can cover every area named ("Bedroom & Hallway Repaint").
 *
 * `summarizeJobName` is the deterministic fallback used when the LLM polish
 * step doesn't supply one; `isValidJobName` is the validator both paths must
 * satisfy. Dependency-free: imported by the Deno backend (with .ts) and the
 * Jest unit suite (extensionless).
 */

/** REQ-337: the budget a job name must fit — 5 words, 30 characters. */
export const JOB_NAME_MAX_WORDS = 5;
export const JOB_NAME_MAX_CHARS = 30;

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "from",
  "with",
  "to",
  "in",
  "on",
  "at",
  "by",
  "is",
  "are",
  "be",
  "no",
  "not",
  "sure",
  "make",
  "making",
  "maksure",
  "that",
  "this",
  "it",
  "up",
  "out",
  "all",
  "any",
  "so",
  "then",
]);

/** Spanish connectors are KEPT mid-name (lowercase) — see the ES path. */
const ES_STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "y",
  "o",
  "para",
  "por",
  "con",
  "en",
  "al",
]);

/** REQ-337 (demo m6): the model's summary names the customer after a spaced
 *  dash ("Bathroom remodel — Dana") and may open with a "Quote:" label;
 *  neither is the job. */
function stripSummaryDecoration(details: string): string {
  return details
    .replace(
      /^\s*(?:quote|estimate|cotización|cotizacion|presupuesto)\s*:\s*/iu,
      "",
    )
    .replace(/\s+[—–-]\s+[\s\S]*$/u, "")
    .replace(
      /^\s*(?:quote|estimate|cotización|cotizacion|presupuesto)\s+(?:for|para|de)\s+/iu,
      "",
    );
}

const RECIPIENT_MARKERS = new Set(["for", "para"]);

/** REQ-337 (demo m6): "Deep clean house for Maria Lopez" — what follows
 *  "for"/"para" is the recipient when a capitalized word (a name) opens it,
 *  or when the job is already named by at least two words before it. */
function cutAtRecipient(words: string[]): string[] {
  for (let i = 1; i < words.length; i++) {
    if (!RECIPIENT_MARKERS.has(words[i].toLowerCase())) continue;
    const before = words.slice(0, i);
    const next = words.slice(i + 1).find((w) =>
      !ES_STOPWORDS.has(w.toLowerCase()) && !STOPWORDS.has(w.toLowerCase())
    );
    const nextIsName = !!next && /^\p{Lu}/u.test(next);
    if (nextIsName || before.length >= 2) return before;
  }
  return words;
}

const isNumeric = (w: string) => /^\p{N}/u.test(w);

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Accent-safe first-letter capitalization (code-point aware, never \b\w). */
function capitalizeFirst(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Spanish derivation (UX-05/26c/29/41): connectors are kept mid-name as
 * lowercase connectors, never first (leading articles/connectors trimmed)
 * and never last (no stopword tail); sentence case, accent-safe.
 */
function summarizeJobNameEs(words: string[], maxWords: number): string {
  // Trim leading connectors/articles — a name never starts with "el"/"de".
  let start = 0;
  while (start < words.length && ES_STOPWORDS.has(words[start].toLowerCase())) {
    start++;
  }
  let window = words.slice(start, start + maxWords);
  // Never end on a stopword — nor on a bare number (REQ-337).
  while (
    window.length > 1 &&
    (ES_STOPWORDS.has(window[window.length - 1].toLowerCase()) ||
      isNumeric(window[window.length - 1]))
  ) {
    window = window.slice(0, -1);
  }
  if (window.length === 0 && words.length > 0) {
    window = [words[0]];
  }
  // Sentence case: only the first word keeps a capital. The LLM's polish
  // step hands this a Title-Cased name ("Instalación De Patio"), and passing
  // its mid-name capitals through printed "Instalación de Patio" on the
  // customer's SMS and agreement (UX-05 / UX-26c over HTTP).
  const cased = window.map((w, i) => {
    if (i === 0) return capitalizeFirst(w);
    return w.toLowerCase();
  });
  return cased.join(" ");
}

/**
 * Deterministically summarize free-form job details into a short name —
 * ≤3 words by default; `opts.maxWords` lets a caller clamping a model-
 * supplied name use the wider JOB_NAME_MAX_WORDS budget (REQ-337).
 */
export function summarizeJobName(
  details: string,
  lang?: "en" | "es",
  opts?: { maxWords?: number },
): string {
  const maxWords = Math.max(1, opts?.maxWords ?? 3);
  const words = cutAtRecipient(
    stripSummaryDecoration(details)
      // REQ-337: an intra-word hyphen keeps its compound whole ("3-bed",
      // "rough-in"); a bullet's or a dangling hyphen is punctuation.
      .replace(/(?<![\p{L}\p{N}])-|-(?![\p{L}\p{N}])/gu, " ")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ") // strip bullets & punctuation
      .split(/\s+/)
      .filter((w) => w.length > 0),
  );

  if (lang === "es") return summarizeJobNameEs(words, maxWords);

  const significant: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const lower = w.toLowerCase();
    if (STOPWORDS.has(lower) || seen.has(lower)) continue;
    // REQ-337: "3-bed", "80sqft", "2" — a digit-led fragment never titles
    // an English document ("Deep Clean 3").
    if (isNumeric(w)) continue;
    seen.add(lower);
    significant.push(titleCase(w));
    if (significant.length === maxWords) break;
  }

  // Terse input made entirely of stopwords still yields something.
  if (significant.length === 0 && words.length > 0) {
    return titleCase(words[0]);
  }
  return significant.join(" ");
}

/**
 * REQ-276 (demo i18n-formatting-m8): the casing a stored job name gets in
 * its language, whatever wrote it (the translate endpoint, an LLM's
 * pre-generated byLang name). Spanish is sentence case — "Corte De Césped"
 * → "Corte de césped" — exactly as summarizeJobNameEs derives it; English
 * names keep their Title Case. Only the case changes, never the words.
 */
export function jobNameCase(name: string, lang?: "en" | "es"): string {
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0);
  if (lang !== "es") return words.join(" ");
  return words
    .map((w, i) => (i === 0 ? capitalizeFirst(w) : w.toLowerCase()))
    .join(" ");
}

/** A valid job name is non-empty and inside the budget (REQ-337: at most
 *  JOB_NAME_MAX_WORDS words and JOB_NAME_MAX_CHARS characters). */
export function isValidJobName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > JOB_NAME_MAX_CHARS) return false;
  return trimmed.split(/\s+/).length <= JOB_NAME_MAX_WORDS;
}

/** REQ-337: fit a model-supplied name to the budget — whole words, never a
 *  cut mid-word; always at least the first word. */
export function fitJobNameToBudget(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0);
  const out: string[] = [];
  for (const w of words) {
    const next = [...out, w].join(" ");
    if (
      out.length > 0 &&
      (next.length > JOB_NAME_MAX_CHARS || out.length >= JOB_NAME_MAX_WORDS)
    ) break;
    out.push(w);
  }
  return out.join(" ");
}
