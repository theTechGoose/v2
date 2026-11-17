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
 *
 * REQ-539 (demo-loop cycle 4, m24) — amends REQ-393 / REQ-451: a hand-off says which page made it
 * (`from`). The stage's own (its pagehide: a reload, the same page and the same spot) is where he
 * points; /admin's (the click on Demo) is only where his mouse is — for a desktop customer the
 * Demo button falls on the fitted frame, and pushing it put the arrow on her mic button. An
 * untagged hand-off (an older page) counts as /admin's: never pushed.
 */
import type { Pt } from "../../../shared/demo-mode/motion.ts";

export const CURSOR_KEY = "pm:demo-cursor";
/** a hand-off older than this is not where the mouse is any more */
export const CURSOR_HANDOFF_MS = 30_000;

/** REQ-539 AMENDMENT (2026-11-16) — does a pointer event on the stage say he MOVED? Chromium fires a
 *  trusted `pointerover` at the mouse's spot some 40 ms after a page loads under a still mouse
 *  (measured: headless shell 1208); that is where the mouse already was — a hint, like /admin's
 *  hand-off — not a move of his. A `pointerover` counts once a `pointermove` / `pointerdown` has
 *  been seen on this page (the frame appearing under his cursor after a fit); those always count */
/** REQ-539 AMENDMENT 2 (demo-loop run 8, m4) — which pointer events on the stage are a move of
 *  his: `pointermove` and `pointerdown`. Never `pointerover` (nor `pointerenter` / `mouseover`):
 *  Chromium fires those, trusted, under a STILL mouse — ~40 ms after a page loads (REQ-539
 *  AMENDMENT), and whenever the element under the mouse changes (the customer narrowed her window
 *  and the fitted frame shrank out from under his cursor: his arrow left "Mailing address" for the
 *  frame's edge). A real move always brings a `pointermove`. */
export function pointerCounts(type: string): boolean {
  return type === "pointermove" || type === "pointerdown";
}

/** REQ-539 — the page that handed the mouse over: /admin (the Demo click) or the stage itself */
export type CursorFrom = "admin" | "stage";
/** REQ-539 — a hand-off, with the page that made it */
export type CursorSeed = Pt & { from: CursorFrom };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** this tab's sessionStorage, or null where it cannot be had (storage off, a sandboxed frame) */
export function sessionStore(): Store | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** the mouse is at `p` now (null: not over this page) — for the stage this tab opens next;
 *  REQ-539 — `from`: the page handing it over */
export function handCursor(
  store: Store | null | undefined,
  p: Pt | null,
  now = Date.now(),
  from: CursorFrom = "admin",
): void {
  if (!store) return;
  try {
    if (p) {
      store.setItem(
        CURSOR_KEY,
        JSON.stringify({ x: p.x, y: p.y, at: now, from }),
      );
    } else store.removeItem(CURSOR_KEY);
  } catch {
    // storage off or full: the stage starts without it, as before
  }
}

/** where the mouse was handed over, once, and by which page (REQ-539 — anything but the stage's
 *  own is /admin's): null when nothing (fresh) was */
export function takeCursor(
  store: Store | null | undefined,
  now = Date.now(),
): CursorSeed | null {
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
    return { x: o.x, y: o.y, from: o.from === "stage" ? "stage" : "admin" };
  } catch {
    return null;
  }
}
