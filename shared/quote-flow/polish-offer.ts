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
 *
 * REQ-675 (demo-loop cycle 5, p18-7b): "…subway tile with dark grout" was
 * offered as "…subway tile dark grout". A single line whose words are all
 * already in the original only DELETES words — it can only make a clear line
 * more telegraphic, so it is not offered either.
 *
 * REQ-751 (demo-loop cycle 5v1, p18-7b re-test): the model also SPLIT lines
 * that name one item ("…in the drywall with joint compound and repaint the
 * area" → three telegraphic lines). Only a line with a top-level "+"/"plus"
 * joiner (`splitJoinedItems`) may come back as several lines.
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

/** REQ-675: true when `after` only deletes words from `before` — every word
 *  of `after` (case and punctuation aside) is already in `before`, counted
 *  with multiplicity, and at least one is gone. Not a polish. */
export function onlyDeletesWords(before: string, after: string): boolean {
  const pool = new Map<string, number>();
  const src = words(before).split(" ").filter(Boolean);
  for (const w of src) pool.set(w, (pool.get(w) ?? 0) + 1);
  const out = words(after).split(" ").filter(Boolean);
  if (out.length >= src.length) return false;
  for (const w of out) {
    const n = pool.get(w) ?? 0;
    if (n === 0) return false;
    pool.set(w, n - 1);
  }
  return true;
}

/** REQ-332: "4 recesed lights + City of Austin permit" → two items. Only an
 *  explicit joiner ("+", "plus") splits; "and" is left to the model, since
 *  "tile, vanity and glass" is one install.
 *  REQ-443 (demo m46): only a TOP-LEVEL joiner splits — one inside (), [] or
 *  {} belongs to its parenthetical ("island (trench + patch)" is one item) —
 *  and only when every piece names an item of its own (has a letter). */
export function splitJoinedItems(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  const joiner = /\s*\+\s*|\s+plus\s+/iy;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) depth--;
    if (depth > 0) continue;
    joiner.lastIndex = i;
    const m = joiner.exec(text);
    if (!m) continue;
    parts.push(text.slice(start, i));
    start = i + m[0].length;
    i = start - 1;
  }
  parts.push(text.slice(start));
  const items = parts.map((p) => p.trim());
  const real = items.every((p) => /\p{L}/u.test(p));
  return items.length > 1 && real ? items : [text];
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
  if (after.length === 1 && onlyDeletesWords(before, after[0])) return null;
  if (after.length > 1 && !after.every(balanced)) return null;
  if (after.length > 1 && splitJoinedItems(before).length < 2) return null;
  return { before, after };
}
