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

/** The bits of a ResizeObserver `holdHashTarget` uses (injectable for tests). */
interface ResizeObs {
  observe(target: never): void;
  disconnect(): void;
}
type ResizeObsCtor = new (cb: () => void) => ResizeObs;

interface HoldTarget {
  scrollIntoView(opts?: ScrollIntoViewOptions): void;
  closest?(selector: string): HoldScroller | null;
}
interface HoldScroller {
  children: ArrayLike<unknown>;
  addEventListener(type: string, fn: () => void, opts?: unknown): void;
  removeEventListener(type: string, fn: () => void, opts?: unknown): void;
}
interface HoldDoc {
  getElementById(id: string): HoldTarget | null;
}

/** Input that means the user is steering the page now. */
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"];

/**
 * REQ-749 (demo-loop cycle 5v1, m57 re-opened). One scroll is not enough: on
 * the first load after login the lists render before the notifications feed
 * fills the Activity panel, so `scrollIntoView` clamps at the page's then
 * bottom (the verifier: scrollTop 410 of an eventual 664, panel at 762 of a
 * 720px viewport). Scroll to the panel now and again on every size change of
 * the scroller's content — until the user takes over or `settleMs` passes.
 * Returns a release function, or null when there is nothing to hold yet (no
 * hash, another hash, the panel not mounted) — the caller retries.
 */
export function holdHashTarget(
  doc: HoldDoc,
  hash: string,
  opts: { ResizeObserver?: ResizeObsCtor; settleMs?: number } = {},
): (() => void) | null {
  if (hash !== ACTIVITY_HASH) return null;
  const el = doc.getElementById(ACTIVITY_HASH.slice(1));
  if (!el) return null;
  const scroll = () => el.scrollIntoView({ block: "start", behavior: "auto" });
  scroll();

  const RO = opts.ResizeObserver ??
    (globalThis as { ResizeObserver?: ResizeObsCtor }).ResizeObserver;
  // The app shell scrolls inside `.content`; its children are what grows.
  const scroller = el.closest?.(".content") ?? null;
  let done = false;
  let ro: ResizeObs | null = null;
  const release = () => {
    if (done) return;
    done = true;
    ro?.disconnect();
    clearTimeout(timer);
    for (const t of USER_SCROLL_EVENTS) {
      scroller?.removeEventListener(t, release, true);
    }
  };
  if (RO) {
    ro = new RO(() => {
      if (!done) scroll();
    });
    for (const c of Array.from(scroller?.children ?? [])) {
      ro.observe(c as never);
    }
    ro.observe(el as never);
  }
  for (const t of USER_SCROLL_EVENTS) {
    scroller?.addEventListener(t, release, true);
  }
  // release only ever runs later (an event, the observer, unmount), so the
  // timer exists by then.
  const timer = setTimeout(release, opts.settleMs ?? 6_000);
  return release;
}
