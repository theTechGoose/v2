/**
 * REQ-262 (demo M25) — the languages a contractor ASKED for in the job text
 * itself ("… in Spanish and English", "en español", "bilingual"). The job
 * options used to take their languages from settings alone, so a typed ask
 * was silently dropped. Returned in the order the text names them; empty when
 * the text asks for nothing.
 *
 * Only a language named as a language counts — after "in" / "en", or joined
 * to another language by "and" / "y" / "&" / "/" — so "Spanish tile" (a
 * material) or "English garden" is not an ask.
 */
export type ChatLang = "en" | "es";

const NAMES: Array<[RegExp, ChatLang]> = [
  [/^(english|ingl[eé]s)$/i, "en"],
  [/^(spanish|espa[nñ]ol)$/i, "es"],
];

const LANG = "(english|spanish|ingl[eé]s|espa[nñ]ol)";
const JOIN = "\\s*(?:and|y|&|\\/|,|plus|\\+)\\s*";

function langOf(word: string): ChatLang | undefined {
  for (const [re, l] of NAMES) if (re.test(word)) return l;
  return undefined;
}

export function requestedLangs(raw: string): ChatLang[] {
  const text = (raw ?? "").normalize("NFC");
  if (!text.trim()) return [];
  const hits: Array<{ at: number; lang: ChatLang }> = [];

  // "X and Y" / "X y Y" — two languages joined, anywhere.
  const pair = new RegExp(`\\b${LANG}${JOIN}${LANG}\\b`, "giu");
  for (const m of text.matchAll(pair)) {
    const a = langOf(m[1]);
    const b = langOf(m[2]);
    if (a) hits.push({ at: m.index ?? 0, lang: a });
    if (b) {
      hits.push({
        at: (m.index ?? 0) + m[0].indexOf(m[2], m[1].length),
        lang: b,
      });
    }
  }
  // "in Spanish" / "en español" — one language introduced as a language.
  const single = new RegExp(`\\b(?:in|en)\\s+${LANG}(?![\\p{L}])`, "giu");
  for (const m of text.matchAll(single)) {
    const l = langOf(m[1]);
    if (l) {
      hits.push({ at: (m.index ?? 0) + m[0].length - m[1].length, lang: l });
    }
  }
  // "bilingual" / "bilingüe" — English and Spanish (the two the app speaks).
  const bi = /\bbiling(?:ual|[uü]e)\b/iu.exec(text);
  if (bi) {
    hits.push({ at: bi.index, lang: "en" }, { at: bi.index + 1, lang: "es" });
  }

  hits.sort((a, b) => a.at - b.at);
  const out: ChatLang[] = [];
  for (const h of hits) if (!out.includes(h.lang)) out.push(h.lang);
  return out;
}
