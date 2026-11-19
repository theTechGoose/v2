/**
 * REQ-955 (LOOP-007 q1-30) — the ONE rule for "an open" of a sent quote. A
 * customer's views of /q are merged to at most one open per hour (a reload, or
 * the SSR read plus a refresh, is still one visit). The /quotes card's count
 * (BuildQuoteCards) and the card's timeline (GET /quotes/:id/opens) both read
 * it, so "1 open" can no longer sit over a timeline that lists two.
 */
export const OPEN_MERGE_MS = 3_600_000;

/** Sort the views oldest-first and keep the first view of each hour bucket
 *  (a bucket starts at a kept view and covers the next 60 minutes). */
export function mergeOpensByHour<T extends { viewedAt: string }>(
  views: readonly T[],
): T[] {
  const sorted = [...views].sort((a, b) =>
    a.viewedAt.localeCompare(b.viewedAt)
  );
  const kept: T[] = [];
  let last: number | null = null;
  for (const v of sorted) {
    const t = new Date(v.viewedAt).getTime();
    if (last == null || t - last >= OPEN_MERGE_MS) {
      kept.push(v);
      last = t;
    }
  }
  return kept;
}
