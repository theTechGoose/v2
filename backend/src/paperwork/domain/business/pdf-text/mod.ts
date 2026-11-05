/**
 * REQ-161 — the PDFs draw with pdf-lib's standard fonts, which encode WinAnsi
 * only: a "→" in an invoice title ("Maintenance 2026-10-01 → 2026-10-31")
 * made every Download PDF answer 500. Every string a renderer draws or
 * measures goes through here first. Pure.
 */

/** the code points 0x80–0x9F that WinAnsi does have */
const WINANSI_HIGH = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split("").map((c) => c.codePointAt(0)!),
);

/** characters that are not in WinAnsi but have an obvious stand-in */
const STAND_IN: Record<string, string> = {
  "→": "–",
  "←": "–",
  "↔": "–",
  "⇒": "–",
  "➜": "–",
  "➔": "–",
  "−": "-", // minus sign
  "‐": "-", // hyphen
  "‑": "-", // non-breaking hyphen
  "′": "'",
  "″": '"',
  "‹": "‹",
  "›": "›",
  " ": " ",
};

const encodable = (cp: number) =>
  (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) ||
  WINANSI_HIGH.has(cp) || cp === 0x0a || cp === 0x0d || cp === 0x09;

export function winAnsiSafe(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (encodable(cp)) {
      out += ch;
      continue;
    }
    if (ch in STAND_IN) {
      out += STAND_IN[ch];
      continue;
    }
    // strip the accent off a letter WinAnsi lacks (ő → o, ł stays a letter below)
    const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    if (
      base !== ch && base.length &&
      [...base].every((c) => encodable(c.codePointAt(0)!))
    ) {
      out += base;
      continue;
    }
    const folded = FOLD[ch];
    if (folded) out += folded;
    // else: dropped (emoji, symbols)
  }
  return out;
}

/** letters NFKD does not decompose but which have a plain-Latin reading */
const FOLD: Record<string, string> = {
  "Ł": "L",
  "ł": "l",
  "Đ": "D",
  "đ": "d",
  "Ħ": "H",
  "ħ": "h",
  "Ŧ": "T",
  "ŧ": "t",
};

/** REQ-161: the same, over every string in a document's data (plain objects and arrays). */
export function winAnsiSafeDeep<T>(v: T): T {
  if (typeof v === "string") return winAnsiSafe(v) as T;
  if (Array.isArray(v)) return v.map(winAnsiSafeDeep) as T;
  if (
    v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = winAnsiSafeDeep(x);
    return out as T;
  }
  return v;
}
