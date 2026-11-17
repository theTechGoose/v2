/**
 * The ONE avatar-initials rule (REQ-502, demo cycle 3 p8-pair10-b). The
 * dashboard sidebar (server `ProfileSnapshot.initials`), its front-end
 * fallback, the public /q and /i sender avatar and the quote/invoice email
 * all go through here, so "Carl" of "Jensen Electric LLC" is "CJ" everywhere
 * — never "CJ" on one screen and "CA" on another.
 *
 * Strategy:
 *   - Strip trailing periods, dots, and "Jr/Sr/III" suffixes.
 *   - Take first letter of first word + first letter of LAST word.
 *   - Single-word names: when a businessName is provided, combine the
 *     first letter of each (e.g. "Diego" + "Riley Roofing" → "DR"),
 *     else take the first two letters of the name.
 *   - No name (or a "name" that is just the business name — the outbound
 *     display fallback): the business's first two words' initials.
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
export function computeInitials(
  name: string | undefined | null,
  businessName?: string | null,
): string {
  const clean = (s: string) =>
    s.replace(/\b(Jr\.?|Sr\.?|III|II|IV)\b/g, "").replace(/[.,]/g, " ")
      .trim();
  if (name && businessName && name.trim() === businessName.trim()) {
    name = undefined;
  }
  if (!name) {
    if (businessName) {
      const bizWords = clean(businessName).split(/\s+/).filter(Boolean);
      if (bizWords.length >= 2) {
        return (bizWords[0][0] + bizWords[1][0]).toUpperCase();
      }
      if (bizWords.length === 1) {
        const w = bizWords[0];
        return (w.length >= 2 ? w.slice(0, 2) : w).toUpperCase();
      }
    }
    return "?";
  }
  const cleaned = clean(name);
  if (cleaned.length === 0) return computeInitials(undefined, businessName);

  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return computeInitials(undefined, businessName);
  if (words.length === 1) {
    if (businessName) {
      const bizWords = clean(businessName).split(/\s+/).filter(Boolean);
      if (bizWords.length >= 1) {
        return (words[0][0] + bizWords[0][0]).toUpperCase();
      }
    }
    const w = words[0];
    return (w.length >= 2 ? w.slice(0, 2) : w).toUpperCase();
  }
  const first = words[0][0];
  const last = words[words.length - 1][0];
  return `${first}${last}`.toUpperCase();
}

/**
 * A document's sender avatar (public quote/invoice page, email): the same
 * rule over the contractor's name + business name; `fallback` (the brand, or
 * the email's "PM") only when the contractor has neither.
 */
export function senderInitials(
  sender:
    | { name?: string | null; businessName?: string | null }
    | null
    | undefined,
  fallback: string,
): string {
  const own = computeInitials(sender?.name, sender?.businessName);
  return own === "?" ? computeInitials(undefined, fallback) : own;
}
