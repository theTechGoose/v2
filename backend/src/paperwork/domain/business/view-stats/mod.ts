import type { View } from "@paperwork/dto/view.ts";

export interface ViewStats {
  total: number;
  uniqueViewers: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
}

export function summarize(views: Pick<View, "viewedAt" | "viewerId" | "viewerEmail">[]): ViewStats {
  if (views.length === 0) {
    return { total: 0, uniqueViewers: 0, firstViewedAt: null, lastViewedAt: null };
  }
  const viewers = new Set<string>();
  let first = views[0].viewedAt;
  let last = views[0].viewedAt;
  for (const v of views) {
    const key = v.viewerId ?? v.viewerEmail ?? null;
    if (key) viewers.add(key);
    if (v.viewedAt < first) first = v.viewedAt;
    if (v.viewedAt > last) last = v.viewedAt;
  }
  return {
    total: views.length,
    uniqueViewers: viewers.size,
    firstViewedAt: first,
    lastViewedAt: last,
  };
}
