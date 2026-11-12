/**
 * REQ-384 (demo-loop cycle 2, m16): the Job Details picker's "polish this
 * line?" offer. The professionalized result is fetched FIRST and offered
 * inline under the bullet as a before → after preview — and only when it is
 * a real rewrite. A result with the same wording (case, spacing and trailing
 * punctuation aside) is an already-clean line: no offer.
 */

export interface PolishOffer {
  /** The line as the contractor wrote it. */
  before: string;
  /** What it would become — one or more lines ("A + B" splits in two). */
  after: string[];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[\s.;,!]+$/, "")
    .trim();
}

/** True when `a` and `b` say the same thing, word for word. */
export function sameWording(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/** The offer to show for `before`, given the professionalized `lines` —
 *  null when there is nothing worth offering. */
export function polishOffer(
  before: string,
  lines: readonly string[],
): PolishOffer | null {
  const after = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (after.length === 0) return null;
  if (after.length === 1 && sameWording(before, after[0])) return null;
  return { before, after };
}
