/**
 * REQ-1109 (LOOP-007 q3-35) — the one money string the customer and the owner
 * read in backend-composed copy (invoice text, reminder 007, nudge 009, the
 * Remind dialog preview, the owner's chat payment reply).
 *
 * REQ-961's house rule: whole dollars stay compact ("$1,000"), anything else
 * keeps BOTH cent digits ("$1,035.50"). `minimumFractionDigits: 0` with
 * `maximumFractionDigits: 2` strips trailing zeros one digit at a time, so
 * 103550 cents read "$1,035.5" — never format money that way.
 *
 * Dependency-free: imported by the backend (#quote-flow/) and the front-end.
 */
export function formatUsdCents(cents: number): string {
  const c = Math.round(cents);
  const digits = c % 100 === 0 ? 0 : 2;
  return "$" + (c / 100).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
