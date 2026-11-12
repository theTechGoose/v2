/**
 * MoneyInput's typing logic (islands/MoneyInput.tsx), kept pure so it can be tested without a DOM.
 *
 * REQ-280 (demo issue M33): the island's <input> is controlled and transparent; when a keystroke
 * left the formatted value unchanged (a letter, a minus sign), Preact had no state change to
 * render, so the raw keystroke stayed in the DOM — and the caret, put back after the digits,
 * sat in front of it, so "-50abc" left the field holding "50cba" while $50.00 was shown.
 * `typeMoney` writes the formatted value back into the field itself, every keystroke.
 */

/** The parts of an <input> the typing logic reads and writes. */
export interface MoneyField {
  value: string;
  selectionStart: number | null;
}

export interface MoneyTyping {
  /** the formatted text the field now holds ("1,234.5") */
  formatted: string;
  /** the amount in cents, or null when nothing is typed */
  cents: number | null;
  /** where the caret belongs in `formatted` */
  caret: number;
}

/** One input event: format what the field holds, write it back, and say where the caret goes. */
export function typeMoney(el: MoneyField): MoneyTyping {
  const raw = el.value;
  const rawCaret = el.selectionStart ?? raw.length;
  const tokensBeforeCaret =
    raw.slice(0, rawCaret).replace(/[^\d.]/g, "").length;
  const formatted = formatTyping(raw);
  // Write it back even when it equals the state the island already holds: Preact renders a
  // controlled value only when state changes, so an unchanged amount would leave the keystroke.
  if (el.value !== formatted) el.value = formatted;
  return {
    formatted,
    cents: parseToCents(formatted),
    caret: caretAfterTokens(formatted, tokensBeforeCaret),
  };
}

/** The index in `formatted` just past its first `tokens` digits/dots (commas are skipped). */
export function caretAfterTokens(formatted: string, tokens: number): number {
  let pos = 0;
  let counted = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (counted >= tokens) break;
    if (/[\d.]/.test(formatted[i])) counted++;
    pos = i + 1;
  }
  return pos;
}

export function parseToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const firstDot = cleaned.indexOf(".");
  let intPart = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
  let decPart = firstDot === -1
    ? ""
    : cleaned.slice(firstDot + 1).replace(/\./g, "");
  if (intPart === "") intPart = "0";
  decPart = (decPart + "00").slice(0, 2);
  const cents = parseInt(intPart, 10) * 100 + parseInt(decPart, 10);
  return Number.isFinite(cents) ? cents : null;
}

export function formatTyping(raw: string): string {
  let s = raw.replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  }
  if (firstDot !== -1) {
    const dec = s.slice(firstDot + 1, firstDot + 3);
    s = s.slice(0, firstDot + 1) + dec;
  }
  const dot2 = s.indexOf(".");
  let intPart = dot2 === -1 ? s : s.slice(0, dot2);
  const decPart = dot2 === -1 ? "" : s.slice(dot2);
  if (intPart.length > 1) intPart = intPart.replace(/^0+/, "") || "0";
  const intFmt = intPart === "" ? "" : Number(intPart).toLocaleString("en-US");
  return intFmt + decPart;
}
