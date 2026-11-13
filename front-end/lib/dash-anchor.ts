/**
 * REQ-726 (demo-loop cycle 5, m57) — landing on /dashboard#activity.
 *
 * The topbar's live-activity pill links to /dashboard#activity, but the
 * DashboardPage island's server render is the skeleton (readCached() has no
 * sessionStorage on the server), so the HTML the browser parses has no
 * #activity and its fragment scroll finds nothing. The panel mounts later —
 * at hydration on a warm start, after the fetch on a cold one — so the island
 * scrolls to it itself, and the first-visit coach mark stays away.
 */
export const ACTIVITY_HASH = "#activity";

interface AnchorDoc {
  getElementById(
    id: string,
  ): { scrollIntoView(opts?: ScrollIntoViewOptions): void } | null;
}

/** Scroll the element the hash names into view (only #activity, the one
 *  in-island anchor). True once it scrolled; false when there is nothing to do
 *  yet (no hash, another hash, the panel not mounted) — the caller retries. */
export function scrollToHashTarget(doc: AnchorDoc, hash: string): boolean {
  if (hash !== ACTIVITY_HASH) return false;
  const el = doc.getElementById(ACTIVITY_HASH.slice(1));
  if (!el) return false;
  el.scrollIntoView({ block: "start", behavior: "auto" });
  return true;
}
