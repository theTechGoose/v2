/**
 * Scope bullets from raw text (REQ-026 / NW-05) — the ONE way a contractor's
 * chat-box sentence becomes scope-of-work bullets when the model cannot
 * (call failed, unparseable reply, dev stub).
 *
 * The old fallbacks bulleted the sentence verbatim, so "I need to replace a
 * toile for $500" came back as three "I Need To" options that repeated the
 * sentence. The client's rule: "The AI must never echo the user's raw input
 * back as the suggested description. We are the ones professionalizing the
 * quotes."
 *
 * Pure and deterministic. Per line (split on newline / ";" / a sentence
 * period) it strips the intent opener ("I need to", "Customer wants a",
 * "Necesito"), the price clause ("for $500", "por $900 todo incluido"), the
 * pricing question ("what should I charge?", "¿cuánto cobro?"), list markers
 * and trailing punctuation; capitalizes the first letter; dedupes. When
 * nothing scope-like survives ("ok") it returns no bullets and
 * `degraded: true` so the caller can say so instead of inventing a job.
 *
 * `lang` is the contractor's language; both rule sets always run because
 * contractors mix English and Spanish in one sentence — the language only
 * drives locale-aware capitalization.
 */

export type ScopeLang = "en" | "es";

export interface ScopeBullets {
  bullets: string[];
  /** True when no scope-like bullet survived — the caller must not pretend. */
  degraded: boolean;
}

// "I need to", "we'd like to", "customer wants a", "the client needs the" …
const INTENT_EN =
  /^(?:(?:i|we)(?:'d|\s+would)?\s+(?:need|want|like)s?\s+(?:to\s+)?|(?:the\s+)?(?:customer|client|they|homeowner|owner)\s+(?:needs?|wants?|would\s+like)\s+(?:to\s+)?|please\s+)(?:(?:a|an|the)\s+)?/i;
// "Necesito", "quiero", "el cliente quiere", "la clienta necesita" …
const INTENT_ES =
  /^(?:necesito|necesitamos|quiero|queremos|ocupo|ocupamos|(?:el|la)\s+cliente\s+(?:quiere|necesita)|me\s+gustaría)\s+(?:(?:un|una|unos|unas|el|la|los|las)\s+)?/i;
// "for $500", ", $1,250.50 total", "por $900 todo incluido", "$2k all in".
// Horizontal whitespace only: a newline after the amount is a line break
// between two scope lines, never part of the price clause.
const PRICE =
  /[ \t]*,?[ \t]*(?:for|por|at|a|de)?[ \t]*\$[ \t]?\d[\d,]*(?:\.\d+)?[ \t]*k?\b(?:[ \t]*(?:usd|dollars|dólares|dolares|total|en[ \t]+total|todo[ \t]+incluido|all[ \t]+in|flat))?/gi;
// "…, what should I charge?" / "¿cuánto cobro?"
const QUESTION_TAIL =
  /,?\s*(?:what\s+(?:should|would|do)\s+(?:i|you)\s+charge|how\s+much\s+(?:should|would|do)\s+(?:i|you)\s+charge|what\s+do\s+you\s+think|cu[aá]nto\s+(?:debo|deber[ií]a|puedo)\s+cobrar|cu[aá]nto\s+cobro|qu[eé]\s+precio\s+(?:le\s+)?pongo)(?:\s+(?:for|por)\s+(?:this|that|it|esto|eso))?\s*\??\s*$/i;
// "what should I charge for a 10x10 slab" / "cuánto cobro por pintar la sala"
const QUESTION_HEAD =
  /^¿?\s*(?:what\s+(?:should|would|do)\s+(?:i|you)\s+charge\s+(?:for|to)\s+|how\s+much\s+(?:should\s+i\s+charge\s+|to\s+charge\s+|for\s+)(?:for\s+|to\s+)?|cu[aá]nto\s+(?:debo|deber[ií]a|puedo)\s+cobrar\s+por\s+|cu[aá]nto\s+cobro\s+por\s+)(?:(?:a|an|the|un|una|el|la)\s+)?/i;
// Small-talk that is not a scope: "ok", "sí", "thanks".
const FILLER =
  /^(?:ok|okay|k|kk|yes|no|yeah|yep|nope|hi|hello|hey|thanks|thank\s+you|sure|test|hola|s[ií]|vale|bueno|listo|gracias|dale)$/i;

function cleanLine(line: string, lang: ScopeLang): string {
  let s = line.trim().replace(/\s+/g, " ");
  s = s.replace(/^[-–—•*·>]+\s*/, ""); // list markers the contractor typed
  s = s.replace(/^[¿¡]+/, "");
  s = s.replace(QUESTION_HEAD, "");
  s = s.replace(INTENT_EN, "");
  s = s.replace(INTENT_ES, "");
  s = s.replace(PRICE, "");
  s = s.replace(QUESTION_TAIL, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[,:;.\-–—\s]+/, "").replace(/[,:;.?!\s]+$/, "").trim();
  if (!s) return "";
  return s[0].toLocaleUpperCase(lang) + s.slice(1);
}

function isScope(s: string): boolean {
  if (!s) return false;
  if (FILLER.test(s)) return false;
  const meaningful = s.replace(/[^\p{L}\p{N}]/gu, "");
  return meaningful.length >= 2;
}

export function scopeBulletsFromRaw(
  raw: string,
  lang: ScopeLang,
): ScopeBullets {
  // Prices go first, on the whole text: "$1,250.50" must not be split at
  // its decimal point.
  const priced = raw.replace(PRICE, " ");
  const lines = priced.split(/\n|;|\.(?=\s|$)/);
  const bullets: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const b = cleanLine(line, lang);
    if (!isScope(b)) continue;
    const key = b.toLocaleLowerCase(lang);
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(b);
  }
  return { bullets, degraded: bullets.length === 0 };
}
