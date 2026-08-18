/**
 * Bilingual onboarding intent parsers (P-04 / P-23).
 *
 * The English vocabularies mirror the backend's existing parsers
 * (backend/src/agents/domain/business/onboarding/mod.ts — SKIP_RE and
 * isAffirmativeReply); the Spanish vocabularies add the words the ES UI
 * itself advertises ("omitir" in the composer placeholders and the
 * address reprompt, "Sí — está correcto" on the state-confirm chip).
 * Matching is case- AND accent-insensitive.
 */

/** Lower-case and strip combining accents ("MÁS TARDE" → "mas tarde"). */
function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// English set mirrors SKIP_RE (onboarding/mod.ts:37); Spanish set is the
// vocabulary the ES composer placeholders + address reprompt advertise.
const SKIP_INTENT_RE =
  /^\s*(?:skip|later|not\s+now|nah|no\s+thanks?|pass|maybe\s+later|nope|omitir|mas\s+tarde|luego|ahora\s+no|saltar)\b/;

/** True when `text` means "skip this question" — EN or ES. */
export function matchesSkipIntent(text: string): boolean {
  if (!text) return false;
  return SKIP_INTENT_RE.test(normalize(text));
}

// English set mirrors isAffirmativeReply (onboarding/mod.ts:285-288);
// Spanish adds sí/si · claro · correcto · así es (accent-stripped here).
const CONFIRM_INTENT_RE =
  /^\s*(?:yes|yep|yup|yeah|yea|y|sure|correct|right|that'?s\s+right|that\s+is\s+right|exactly|sounds?\s+(?:good|right)|👍|✅|si|claro|correcto|asi\s+es)\b/;

/** True when `text` means "yes, that's right" — EN or ES. */
export function matchesConfirmIntent(text: string): boolean {
  if (!text) return false;
  return CONFIRM_INTENT_RE.test(normalize(text));
}
