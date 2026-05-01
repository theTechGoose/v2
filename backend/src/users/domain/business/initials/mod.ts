/**
 * Compute the 2-letter sidebar avatar initials for a User.
 *
 * Strategy:
 *   - Strip trailing periods, dots, and "Jr/Sr/III" suffixes.
 *   - Take first letter of first word + first letter of LAST word.
 *   - Single-word names: when a businessName is provided, combine the
 *     first letter of each (e.g. "Diego" + "Riley Roofing" → "DR"),
 *     else take the first two letters of the name.
 *   - Empty / whitespace-only / undefined: return "?" so the avatar still
 *     renders something rather than collapsing.
 *
 * Examples:
 *   "Diego R."             → "DR"
 *   "Diego Riley"          → "DR"
 *   "Diego R. Riley III"   → "DR"
 *   "Diego" + "Riley Co."  → "DR"
 *   "Diego"                → "DI"
 *   "D"                    → "D"
 *   "" / undefined         → "?"
 */
export function computeInitials(name: string | undefined, businessName?: string): string {
  const clean = (s: string) =>
    s.replace(/\b(Jr\.?|Sr\.?|III|II|IV)\b/g, "").replace(/[.,]/g, " ").trim();
  if (!name) {
    if (businessName) {
      const bizWords = clean(businessName).split(/\s+/).filter(Boolean);
      if (bizWords.length >= 2) return (bizWords[0][0] + bizWords[1][0]).toUpperCase();
      if (bizWords.length === 1) {
        const w = bizWords[0];
        return (w.length >= 2 ? w.slice(0, 2) : w).toUpperCase();
      }
    }
    return "?";
  }
  const cleaned = clean(name);
  if (cleaned.length === 0) return "?";

  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    if (businessName) {
      const bizWords = clean(businessName).split(/\s+/).filter(Boolean);
      if (bizWords.length >= 1) return (words[0][0] + bizWords[0][0]).toUpperCase();
    }
    const w = words[0];
    return (w.length >= 2 ? w.slice(0, 2) : w).toUpperCase();
  }
  const first = words[0][0];
  const last = words[words.length - 1][0];
  return `${first}${last}`.toUpperCase();
}
