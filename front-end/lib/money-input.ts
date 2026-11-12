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

/* ------------------------------------------------------------------------------------------- */
/* REQ-329 (demo p15-13): quick chips and the magnitude bar scale to an anchor amount.          */
/* ------------------------------------------------------------------------------------------- */

/** The chips with no anchor — the fixed list the pad always showed. */
export const CHIP_PRESETS_CENTS = [50_00, 100_00, 500_00, 1_000_00, 5_000_00];

/** Without an anchor the bar is log-scaled and fills at $100M. */
export const MAGNITUDE_REF_CENTS = 100_000_000_00;

/** The chips as fractions/multiples of the anchor — the 1× chip is the anchor itself. */
export const CHIP_ANCHOR_FACTORS = [0.5, 0.75, 1, 1.25, 1.5];

/**
 * The grid the chips snap to: half a step of the anchor's second significant digit, in cents.
 * $18,000 → $500 · $1,850 → $50 · $347 → $5 · $42 → $0.50; never below one cent.
 */
export function chipGridCents(anchorCents: number): number {
  const dollars = anchorCents / 100;
  const secondDigitDollars = Math.pow(10, Math.floor(Math.log10(dollars)) - 1);
  return Math.max(1, Math.round(secondDigitDollars * 100 / 2));
}

/**
 * Quick-amount chips for an amount pad. With a positive anchor (the AI's market price, the draft
 * total) the chips are 0.5×, 0.75×, 1×, 1.25×, 1.5× of it snapped to `chipGridCents`, unique and
 * ascending; without one the fixed list.
 */
export function chipPresetsFor(anchorCents?: number | null): number[] {
  if (!anchorCents || !Number.isFinite(anchorCents) || anchorCents <= 0) {
    return CHIP_PRESETS_CENTS;
  }
  const anchor = Math.round(anchorCents);
  const grid = chipGridCents(anchor);
  const chips = CHIP_ANCHOR_FACTORS.map((f) =>
    f === 1 ? anchor : Math.round((anchor * f) / grid) * grid
  ).filter((c) => c > 0);
  return [...new Set(chips)].sort((a, b) => a - b);
}

/**
 * The magnitude bar's fill, 0..1. With an anchor it is linear and full at the top chip (1.5×);
 * without one it is log-scaled so $50 reads and $5k still has headroom.
 */
export function magnitudeFill(
  cents: number | null | undefined,
  anchorCents?: number | null,
): number {
  const v = cents ?? 0;
  if (v <= 0) return 0;
  if (anchorCents && anchorCents > 0) {
    return Math.min(1, v / (anchorCents * 1.5));
  }
  return Math.min(1, Math.log10(1 + v) / Math.log10(1 + MAGNITUDE_REF_CENTS));
}
