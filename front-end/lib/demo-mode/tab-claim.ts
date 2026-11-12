/**
 * REQ-549 (demo-loop cycle 4, issue S4) — when a customer page may claim the stage on its own,
 * without a click: at its load, and when a demo starts while it is open.
 *
 * REQ-436 took "in front" (visible AND focused) as the test. A headless browser (the demo-loop's
 * Playwright) emulates focus on every page, so every tab passes it: a background /i/ tab that
 * reloaded itself when its invoice was paid took the stage (pair 9), and on a demo restart every
 * open tab claimed and the later one won (pair 8). Two rules hold in any browser:
 *
 *   - a reload the app starts on its own (a page re-reading the server, not the customer) leaves a
 *     mark in the tab's sessionStorage; the next page takes it and skips its load-time claim;
 *   - every pointerdown / keydown in any tab writes that tab's key and the time to localStorage
 *     (shared by the tabs of the browser): a page whose load is older than ANOTHER tab's newest
 *     input is not the tab the customer is using, so it does not claim on load or at demo start.
 *
 * A click, a key, focus or a tab coming to the front still claims at once, as before.
 */

/** sessionStorage: the time the app reloaded this tab on its own */
export const SELF_RELOAD_STORAGE = "pm:demo-self-reload";
/** localStorage: `{ k: tabKey, at: ms }` — the tab that had the newest user input */
export const INPUT_STORAGE = "pm:demo-input";
/** a mark older than this is left over from a reload that never happened */
export const SELF_RELOAD_TTL_MS = 30_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface NewestInput {
  k: string;
  at: number;
}

/** the app is about to reload this tab on its own */
export function markSelfReload(
  store: Store | null | undefined,
  now = Date.now(),
): void {
  try {
    store?.setItem(SELF_RELOAD_STORAGE, String(now));
  } catch { /* refused */ }
}

/** this page came from the app's own reload (the mark is fresh); the mark is gone after */
export function takeSelfReload(
  store: Store | null | undefined,
  now = Date.now(),
): boolean {
  try {
    const had = store?.getItem(SELF_RELOAD_STORAGE);
    if (had == null) return false;
    store?.removeItem(SELF_RELOAD_STORAGE);
    const at = Number(had);
    return Number.isFinite(at) && now - at >= 0 &&
      now - at < SELF_RELOAD_TTL_MS;
  } catch {
    return false;
  }
}

/** user input in tab `tab` now */
export function noteInput(
  shared: Store | null | undefined,
  tab: string,
  now = Date.now(),
): void {
  try {
    shared?.setItem(INPUT_STORAGE, JSON.stringify({ k: tab, at: now }));
  } catch { /* refused */ }
}

/** the tab with the newest user input, or null when none is known */
export function newestInput(
  shared: Pick<Storage, "getItem"> | null | undefined,
): NewestInput | null {
  try {
    const raw = shared?.getItem(INPUT_STORAGE);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<NewestInput>;
    if (typeof v?.k !== "string" || typeof v.at !== "number") return null;
    return { k: v.k, at: v.at };
  } catch {
    return null;
  }
}

/** does this page claim the stage without a click (at its load, or as a demo starts)? */
export function loadClaim(o: {
  /** visible and focused (REQ-436) */
  inFront: boolean;
  /** this page came from the app's own reload */
  selfReload: boolean;
  /** this tab's key */
  tab: string;
  /** when this page loaded (ms, the same clock as the input times) */
  loadedAt: number;
  newest: NewestInput | null;
}): boolean {
  if (!o.inFront || o.selfReload) return false;
  const n = o.newest;
  // another tab was used since this page loaded: the customer is there, not here
  if (n && n.k !== o.tab && n.at > o.loadedAt) return false;
  return true;
}

/** the browser's sessionStorage ("session") / localStorage ("local"), or null where refused */
export function browserStore(which: "session" | "local"): Store | null {
  try {
    const g = globalThis as unknown as Record<string, Store | undefined>;
    return g[which === "session" ? "sessionStorage" : "localStorage"] ?? null;
  } catch {
    return null;
  }
}
