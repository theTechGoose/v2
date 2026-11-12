/**
 * REQ-384 (demo-loop cycle 2, m16): the Job Details picker's "polish this
 * line?" offer. The professionalized result is fetched FIRST and offered
 * inline under the bullet as a before → after preview — and only when it is
 * a real rewrite. A result with the same wording (case, spacing and trailing
 * punctuation aside) is an already-clean line: no offer.
 *
 * REQ-443 (demo-loop cycle 3, m46): "(trench + patch)" was offered as
 * "(trench" / "Patch)". A single line that differs from the original only in
 * case or punctuation is not a rewrite, and a split that leaves any line with
 * an unbalanced bracket is a broken split — neither is offered.
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

/** The words of `s`, lowercased — case and every punctuation mark aside. */
function words(s: string): string {
  return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
}

/** True when every (, [ and { in `s` is closed in order. */
function balanced(s: string): boolean {
  const close: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (ch in close && stack.pop() !== close[ch]) return false;
  }
  return stack.length === 0;
}

/** The offer to show for `before`, given the professionalized `lines` —
 *  null when there is nothing worth offering. */
export function polishOffer(
  before: string,
  lines: readonly string[],
): PolishOffer | null {
  const after = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (after.length === 0) return null;
  if (after.length === 1 && words(before) === words(after[0])) return null;
  if (after.length > 1 && !after.every(balanced)) return null;
  return { before, after };
}
