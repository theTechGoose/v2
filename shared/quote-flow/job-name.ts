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
  "a", "an", "the", "and", "or", "of", "for", "from", "with", "to", "in",
  "on", "at", "by", "is", "are", "be", "no", "not", "sure", "make", "making",
  "maksure", "that", "this", "it", "up", "out", "all", "any", "so", "then",
]);

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Deterministically summarize free-form job details into ≤3 title-cased words. */
export function summarizeJobName(details: string): string {
  const words = details
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // strip bullets & punctuation
    .split(/\s+/)
    .filter((w) => w.length > 0);

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
