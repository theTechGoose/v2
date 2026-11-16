/**
 * REQ-892 (demo-loop run 6, dm6, issue m3) — a tab whose demo a sign-out dropped rejoins once the
 * customer has signed in again in another tab, whatever session-less page it is on.
 *
 * REQ-879 taught a session-less /login to watch for the shared cookie coming back to life and go
 * on. But DashSidebar's logout lands the tab on "/", and every other page rendered without a
 * session (a public quote, a legal page, a 401's redirect) runs no demo code at all: _app.tsx
 * mounts the overlay only when the request carried a session. So the customer who signed out in
 * tab B and back in in tab A looked at B — the landing — while the stage followed A and said
 * "Live".
 *
 * The overlay's signout gate `markDemoRejoin`s the tab (sessionStorage: the tab's own, kept across
 * its page loads) when it drops a demo. A session-less page loads demo-rejoin.ts, a module script
 * of its own, which `startDemoRejoin`s only while that mark is fresh: it watches as /login does
 * (`watchLoginRejoin`: focus, the tab shown, a click, a key — one ask a second) and once GET
 * /api/me answers the tab goes to the dashboard from "/" or reloads its own page elsewhere, the
 * mark cleared. That page has the session, mounts the overlay and claims the stage. An ordinary
 * anonymous visitor carries no mark: nothing is installed, nothing is asked. /login and /verify
 * keep REQ-879's own watcher; the stage is the presenter's.
 */
import { type LoginRejoinOptions, watchLoginRejoin } from "../login-rejoin.ts";

/** where the tab keeps the mark */
export const REJOIN_MARK_KEY = "pm:demo-rejoin";
/** how long after the sign-out a session-less page still watches (she may take a while to sign
 *  in again; a mark older than this is a tab left over from another day) */
export const REJOIN_MARK_MS = 30 * 60_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** the sign-out dropped this tab's demo: remember to rejoin */
export function markDemoRejoin(
  store: Store | null | undefined,
  now: number,
): void {
  try {
    store?.setItem(REJOIN_MARK_KEY, JSON.stringify({ at: now }));
  } catch { /* refused or full: the tab does not rejoin by itself */ }
}

/** the tab rejoined (or the mark is spent) */
export function clearDemoRejoin(store: Store | null | undefined): void {
  try {
    store?.removeItem(REJOIN_MARK_KEY);
  } catch { /* refused */ }
}

/** pages with a watcher of their own (REQ-879's LoginForm), and the presenter's stage */
const OWN_WATCHER = /^\/(login|verify|demo\/stage)(\/|$)/;

/** should this session-less page watch for the session coming back? */
export function demoRejoinWanted(o: {
  store: Store | null | undefined;
  pathname: string;
  now: number;
}): boolean {
  if (OWN_WATCHER.test(o.pathname)) return false;
  let raw: string | null = null;
  try {
    raw = o.store?.getItem(REJOIN_MARK_KEY) ?? null;
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const at = JSON.parse(raw)?.at;
    return typeof at === "number" && o.now - at <= REJOIN_MARK_MS &&
      o.now >= at - 1_000;
  } catch {
    return false;
  }
}

/** where a signed-in-again tab goes: the dashboard from the landing (a signed-in "/" redirects
 *  there anyway), else its own page again (as itself: the same URL means "reload") */
export function demoRejoinTarget(
  o: { pathname: string; href: string },
): string {
  return o.pathname === "/" ? "/dashboard" : o.href;
}

export interface DemoRejoinOptions {
  store: Store | null | undefined;
  loc: { pathname: string; href: string };
  win: LoginRejoinOptions["win"];
  doc: LoginRejoinOptions["doc"];
  signedIn: () => Promise<boolean>;
  go: (to: string) => void;
  reload: () => void;
  /** wall-clock now, for the mark's age */
  now?: () => number;
  /** REQ-879's one-ask-a-second clock */
  clock?: () => number;
}

/** install the watch when the page wants one; null when it does not (nothing listens) */
export function startDemoRejoin(o: DemoRejoinOptions): (() => void) | null {
  const now = o.now ?? Date.now;
  if (
    !demoRejoinWanted({ store: o.store, pathname: o.loc.pathname, now: now() })
  ) {
    return null;
  }
  const target = demoRejoinTarget(o.loc);
  return watchLoginRejoin({
    win: o.win,
    doc: o.doc,
    signedIn: o.signedIn,
    target,
    clock: o.clock,
    go: (to) => {
      clearDemoRejoin(o.store);
      if (to === o.loc.href) o.reload();
      else o.go(to);
    },
  });
}
