/**
 * REQ-393 (demo-loop cycle 2, M2) — where the staff's mouse is, handed from the page that sends
 * them to the stage to the stage itself.
 *
 * A page loaded under a still mouse gets no pointer event at all: Chromium sends none on load,
 * nor when an element appears under the pointer (measured, headless shell and Chrome for
 * Testing). So a stage just opened from /admin, or reloaded, did not know where the presenter's
 * cursor was until he moved it, and the customer saw no pointer at the start or after a restart.
 * The page that opens the stage (the overlay's placePresenter) and the stage itself on its way out
 * (pagehide) put the last pointer position in this tab's sessionStorage; the stage takes it once,
 * while it is fresh, and only until a real pointer event says where the mouse is. Both pages are
 * one tab and one viewport, so the point means the same place on both.
 */
import type { Pt } from "../../../shared/demo-mode/motion.ts";

export const CURSOR_KEY = "pm:demo-cursor";
/** a hand-off older than this is not where the mouse is any more */
export const CURSOR_HANDOFF_MS = 30_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** this tab's sessionStorage, or null where it cannot be had (storage off, a sandboxed frame) */
export function sessionStore(): Store | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** the mouse is at `p` now (null: not over this page) — for the stage this tab opens next */
export function handCursor(
  store: Store | null | undefined,
  p: Pt | null,
  now = Date.now(),
): void {
  if (!store) return;
  try {
    if (p) {
      store.setItem(CURSOR_KEY, JSON.stringify({ x: p.x, y: p.y, at: now }));
    } else store.removeItem(CURSOR_KEY);
  } catch {
    // storage off or full: the stage starts without it, as before
  }
}

/** where the mouse was handed over, once: null when nothing (fresh) was */
export function takeCursor(
  store: Store | null | undefined,
  now = Date.now(),
): Pt | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(CURSOR_KEY);
    store.removeItem(CURSOR_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    const ok = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v);
    if (!o || !ok(o.x) || !ok(o.y) || !ok(o.at)) return null;
    if (now - o.at > CURSOR_HANDOFF_MS || o.at > now) return null;
    return { x: o.x, y: o.y };
  } catch {
    return null;
  }
}
