/**
 * REQ-879 (demo-loop cycle dm5, issue m3) — a /login page rendered without a session (client.ts's
 * 401 redirect to /login?next=…, a tab left over from a sign-out) runs no demo code: _app.tsx
 * mounts DemoModeOverlay only when the request carried a session. When the customer signs in
 * again in another tab, the browser's shared cookie holds a live session, but this tab never
 * noticed; the stage kept following her other tab and said "Live" while she looked at this one.
 *
 * `watchLoginRejoin` listens for her coming back to the tab (focus, the tab shown again, a page
 * restored from the back-forward cache, a click or a key in it) and asks `signedIn()` (GET
 * /api/me with the browser's cookie). Once it answers, the tab goes to `target` — `next`, or the
 * dashboard — and that page loads with the session, mounts the overlay and claims the stage.
 * One ask at a time, at most one a second; it goes once.
 */

/** where a signed-in /login goes: `?next=` when it is a path on this site (never back to a
 *  sign-in page), else the dashboard */
export function rejoinTarget(search: string): string {
  let next: string | null = null;
  try {
    next = new URLSearchParams(search).get("next");
  } catch {
    next = null;
  }
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }
  if (next.includes("\\")) return "/dashboard";
  try {
    const u = new URL(next, "http://app.invalid");
    if (u.origin !== "http://app.invalid") return "/dashboard";
    if (/^\/(login|verify)(\/|$)/.test(u.pathname)) return "/dashboard";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/dashboard";
  }
}

type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; body?: { cancel(): Promise<void> } | null }>;

/** does the browser's cookie hold a live session now? GET /api/me; the body is never read and
 *  never left open */
export async function signedInNow(
  fetchFn: FetchLike = (u, i) => fetch(u, i),
): Promise<boolean> {
  try {
    const r = await fetchFn("/api/me", {
      credentials: "include",
      cache: "no-store",
    });
    try {
      await r.body?.cancel();
    } catch {
      // nothing to release
    }
    return r.ok;
  } catch {
    return false;
  }
}

interface Events {
  addEventListener(t: string, f: (e: Event) => void): void;
  removeEventListener(t: string, f: (e: Event) => void): void;
}

export interface LoginRejoinOptions {
  win: Events;
  doc: Events & { visibilityState: string };
  signedIn: () => Promise<boolean>;
  go: (to: string) => void;
  target: string;
  clock?: () => number;
}

/** at most one ask a second (a click and a focus come together) */
export const REJOIN_GAP_MS = 1_000;

export function watchLoginRejoin(o: LoginRejoinOptions): () => void {
  const clock = o.clock ?? Date.now;
  let asking = false;
  let gone = false;
  let last = -Infinity;
  const ask = () => {
    if (gone || asking) return;
    const now = clock();
    if (now - last < REJOIN_GAP_MS) return;
    last = now;
    asking = true;
    o.signedIn().then((yes) => {
      asking = false;
      if (yes && !gone) {
        gone = true;
        o.go(o.target);
      }
    }, () => {
      asking = false;
    });
  };
  const onVisible = () => {
    if (o.doc.visibilityState === "visible") ask();
  };
  const onShow = (e: Event) => {
    if ((e as PageTransitionEvent).persisted) ask();
  };
  const onWin: Array<[string, (e: Event) => void]> = [
    ["focus", ask],
    ["pointerdown", ask],
    ["keydown", ask],
    ["pageshow", onShow],
  ];
  for (const [t, f] of onWin) o.win.addEventListener(t, f);
  o.doc.addEventListener("visibilitychange", onVisible);
  return () => {
    for (const [t, f] of onWin) o.win.removeEventListener(t, f);
    o.doc.removeEventListener("visibilitychange", onVisible);
  };
}
