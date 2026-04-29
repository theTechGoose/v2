/**
 * Compute the 2-letter sidebar avatar initials for a User.
 *
 * Strategy:
 *   - Strip trailing periods, dots, and "Jr/Sr/III" suffixes.
 *   - Take first letter of first word + first letter of LAST word.
 *   - Single-word names: take the first two letters.
 *   - Empty / whitespace-only / undefined: return "?" so the avatar still
 *     renders something rather than collapsing.
 *
 * Examples:
 *   "Diego R."             → "DR"
 *   "Diego Riley"          → "DR"
 *   "Diego R. Riley III"   → "DR"
 *   "Diego"                → "DI"
 *   "D"                    → "D"
 *   "" / undefined         → "?"
 */
export function computeInitials(name: string | undefined): string {
  if (!name) return "?";
  const cleaned = name
    .replace(/\b(Jr\.?|Sr\.?|III|II|IV)\b/g, "")
    .replace(/[.,]/g, " ")
    .trim();
  if (cleaned.length === 0) return "?";

  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const w = words[0];
    return (w.length >= 2 ? w.slice(0, 2) : w).toUpperCase();
  }
  const first = words[0][0];
  const last = words[words.length - 1][0];
  return `${first}${last}`.toUpperCase();
}
