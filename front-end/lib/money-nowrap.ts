/**
 * REQ-716 (demo-loop cycle 5, issue p2) — a signed amount stays on one line.
 *
 * Browsers may break a line between a minus/plus sign and "$" (both are
 * "prefix" characters for line breaking), so the assistant's reply
 * "(−$500.00)" read "(−" at the end of a line and "$500.00)" on the next. An
 * invisible WORD JOINER (U+2060) between the sign and the "$" forbids that
 * break; the amount itself ("$500.00") never breaks anyway.
 */
export const WORD_JOINER = "⁠";

const SIGNED_DOLLAR = /([−+-])\$/g;

/** `text` with every sign-before-"$" glued to its "$". Idempotent. */
export function keepMoneyTogether(text: string): string {
  return text.replace(SIGNED_DOLLAR, `$1${WORD_JOINER}$$`);
}
