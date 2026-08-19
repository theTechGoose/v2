/**
 * Job Name — the ≤3-word human label for a job, used consistently across the
 * platform (quote heading, chat card, email subject, SMS body, contract hero).
 *
 * `summarizeJobName` is the deterministic fallback used when the LLM polish
 * step doesn't supply one; `isValidJobName` is the validator both paths must
 * satisfy. Dependency-free: imported by the Deno backend (with .ts) and the
 * Jest unit suite (extensionless).
 */

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
function summarizeJobNameEs(words: string[]): string {
  // Trim leading connectors/articles — a name never starts with "el"/"de".
  let start = 0;
  while (start < words.length && ES_STOPWORDS.has(words[start].toLowerCase())) {
    start++;
  }
  let window = words.slice(start, start + 3);
  // Never end on a stopword.
  while (
    window.length > 0 &&
    ES_STOPWORDS.has(window[window.length - 1].toLowerCase())
  ) {
    window = window.slice(0, -1);
  }
  if (window.length === 0 && words.length > 0) {
    window = [words[0]];
  }
  const cased = window.map((w, i) => {
    if (i === 0) return capitalizeFirst(w);
    if (ES_STOPWORDS.has(w.toLowerCase())) return w.toLowerCase();
    return w;
  });
  return cased.join(" ");
}

/** Deterministically summarize free-form job details into ≤3 words. */
export function summarizeJobName(details: string, lang?: "en" | "es"): string {
  const words = details
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // strip bullets & punctuation
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (lang === "es") return summarizeJobNameEs(words);

  const significant: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const lower = w.toLowerCase();
    if (STOPWORDS.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    significant.push(titleCase(w));
    if (significant.length === 3) break;
  }

  // Terse input made entirely of stopwords still yields something.
  if (significant.length === 0 && words.length > 0) {
    return titleCase(words[0]);
  }
  return significant.join(" ");
}

/** A valid job name is 1–3 non-empty words. */
export function isValidJobName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  return trimmed.split(/\s+/).length <= 3;
}
