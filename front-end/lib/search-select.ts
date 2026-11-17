/**
 * REQ-136 — the pure rules behind the SearchSelect island: what a query matches,
 * in what order, how many rows the list draws, and where the keyboard highlight goes.
 */

export interface SearchOption {
  id: string;
  label: string;
  /** A second line (city, email, company…) — searched, drawn smaller. */
  hint?: string;
}

export interface SearchResult<T extends SearchOption> {
  /** The rows to draw: the best `limit` matches, in rank order. */
  items: T[];
  /** Every match, drawn or not. */
  total: number;
}

/** The rows a thousand-row list draws at once. */
export const SEARCH_SELECT_LIMIT = 50;

/** lower-case, accents stripped, whitespace collapsed */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(
    /\s+/g,
    " ",
  ).trim();
}

/** 0 = the label starts with the query, 1 = a word of the label does, 2 = the label contains it,
 *  3 = only the hint matches, -1 = no match. */
function rank(label: string, hint: string, q: string): number {
  if (label.startsWith(q)) return 0;
  const at = label.indexOf(q);
  if (at < 0) return hint.includes(q) ? 3 : -1;
  if (label.includes(` ${q}`)) return 1;
  return 2;
}

export function filterOptions<T extends SearchOption>(
  options: readonly T[],
  query: string,
  limit = SEARCH_SELECT_LIMIT,
): SearchResult<T> {
  const q = fold(query);
  if (!q) return { items: options.slice(0, limit), total: options.length };
  const ranked: { o: T; r: number; i: number }[] = [];
  options.forEach((o, i) => {
    const r = rank(fold(o.label), fold(o.hint ?? ""), q);
    if (r >= 0) ranked.push({ o, r, i });
  });
  ranked.sort((a, b) => a.r - b.r || a.i - b.i);
  return {
    items: ranked.slice(0, limit).map((x) => x.o),
    total: ranked.length,
  };
}

/** The next highlighted row: wraps at both ends; -1 when there are no rows. */
export function moveActive(
  current: number,
  delta: number,
  count: number,
): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** REQ-283 — the name a "+ Add …" row offers to create: the trimmed query, or null when it is
 *  blank or already an option's label (case, accents and spacing ignored). */
export function createOffer(
  options: readonly SearchOption[],
  query: string,
): string | null {
  const name = query.trim().replace(/\s+/g, " ");
  if (!name) return null;
  const q = fold(name);
  return options.some((o) => fold(o.label) === q) ? null : name;
}
