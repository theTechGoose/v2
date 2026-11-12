/**
 * REQ-228 — where the demo pills go so they never cover the page (demo issue
 * pointer-and-replica-side-effects-m4).
 *
 * The customer's pill is one line and sits in the first slot of the screen with nothing of the
 * page under it: the four corners first (bottom-left, the old place, leads), then down the left
 * and right edges from the bottom up. A clear current slot is kept (no hopping). The staff stage
 * keeps the frame out of the band its own pill measures (its height, its offset from the bottom,
 * a gap) instead of a guessed 76 px.
 *
 * REQ-295 (demo-loop cycle 1, M1) — "clear" means nothing of the page under it: no control, no
 * image / canvas / dialog, no text, no painted card or bar (`countsAsPage`). The pill never falls
 * back onto the page: nothing clear at full size → the compact form; nothing clear compact → room
 * is reserved under the page (`setPillRoom`, the REQ-181 way) and the pill sits in it. The slots
 * are computed from a reserved box (the size rounded up to steps) so the pill's own size changes
 * do not move them; the box is remembered per path for the tab so a reload does not hop it; and a
 * move glides. The stage gets the box (`pill` peer message) and draws its ghost.
 */
import type { PillStatus, Rect } from "./protocol.ts";

export type Corner = "bl" | "br" | "tl" | "tr";
/** bottom-left (where the pill always was) first */
export const PILL_CORNERS: readonly Corner[] = ["bl", "br", "tl", "tr"];
/** the pill's distance from the screen's edges */
export const PILL_MARGIN = 12;
/** at or below this width the customer's pill shows only its status and End (details on tap) */
export const PILL_COMPACT_MAX_W = 640;
/** REQ-294 — the pills' own font: the app's `--font-body` stack, so a pill reads the same on a
 *  page that loads no app stylesheet (the 404 page), where `font:inherit` fell back to the
 *  browser's default face */
export const PILL_FONT =
  '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
/** what counts as a control of the page: a pill on top of one of these is in the way */
export const CONTROL_SELECTOR =
  'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"]';
/** REQ-295 — what else is the page: pictures, drawings, video, a dialog and its backdrop */
export const PAGE_MEDIA_SELECTOR =
  'img,picture,svg,canvas,video,dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
/** REQ-295 — a painted box (a background or a border) this large a part of the viewport or more
 *  is the page's backdrop, not a card or a bar */
export const PAGE_BACKDROP_AREA = 0.6;
/** REQ-295 — the slots come from the pill's size rounded up to these steps */
export const PILL_BOX_STEP = { w: 40, h: 8 } as const;
/** REQ-295 — a move glides this long */
export const PILL_MOVE_MS = 250;
/** REQ-295 — the room reserved under the page when no spot is clear (on <html>, like --banner-h) */
export const PILL_ROOM_VAR = "--demo-pill-h";
/** REQ-295 — the tab remembers the pill's box per page path under this prefix */
export const PILL_BOX_KEY = "pm-demo-pill:";

type Size = { w: number; h: number };

/** REQ-295 — what the topmost element under one sample point is */
export interface UnderPoint {
  /** the document's root or body: the page's own backdrop */
  root: boolean;
  /** a control (CONTROL_SELECTOR) or inside one */
  control: boolean;
  /** media or a dialog (PAGE_MEDIA_SELECTOR) or inside one */
  media: boolean;
  /** has text of its own on screen */
  text: boolean;
  /** draws a background or a border */
  painted: boolean;
  /** its box's share of the viewport's area (0..1) */
  areaFrac: number;
}

/** REQ-295 — is that something of the page a pill must not cover? */
export function countsAsPage(u: UnderPoint): boolean {
  if (u.root) return false;
  if (u.control || u.media || u.text) return true;
  return u.painted && u.areaFrac < PAGE_BACKDROP_AREA;
}

/** REQ-295 — do two boxes share any area? */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width &&
    a.top < b.top + b.height && b.top < a.top + a.height;
}

/** REQ-295 — the box the pill reserves: its size rounded up to the steps (a status change or a
 *  name cut keeps the same box, so the slots stay put) */
export function reservedBox(size: Size, step = PILL_BOX_STEP): Size {
  return {
    w: Math.ceil(Math.max(1, size.w) / step.w) * step.w,
    h: Math.ceil(Math.max(1, size.h) / step.h) * step.h,
  };
}

/** the pill's box at a corner of the view, a margin in from both edges */
export function cornerRect(
  corner: Corner,
  view: Size,
  pill: Size,
  margin = PILL_MARGIN,
): Rect {
  const left = corner[1] === "l" ? margin : view.w - margin - pill.w;
  const top = corner[0] === "t" ? margin : view.h - margin - pill.h;
  return { left, top, width: pill.w, height: pill.h };
}

/** every place the pill may go, best first: the corners, then the side edges from the bottom up */
export function pillSlots(
  view: Size,
  pill: Size,
  margin = PILL_MARGIN,
): Rect[] {
  const out = PILL_CORNERS.map((c) => cornerRect(c, view, pill, margin));
  const step = Math.max(8, Math.round(pill.h / 2));
  const lowest = view.h - margin - pill.h;
  for (let top = lowest - step; top > margin; top -= step) {
    out.push({ left: margin, top, width: pill.w, height: pill.h });
    out.push({
      left: view.w - margin - pill.w,
      top,
      width: pill.w,
      height: pill.h,
    });
  }
  return out;
}

/** a grid of points over a box, edges included, a little inside them (to ask what is under it) */
export function samplePoints(
  r: Rect,
  cols = 5,
  rows = 3,
): { x: number; y: number }[] {
  const pad = Math.min(2, r.width / 4, r.height / 4);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      pts.push({
        x: r.left + pad + ((r.width - 2 * pad) * i) / Math.max(1, cols - 1),
        y: r.top + pad + ((r.height - 2 * pad) * j) / Math.max(1, rows - 1),
      });
    }
  }
  return pts;
}

/** the slot to use: the current box while it is clear, else the first clear slot; REQ-295 — when
 *  nothing is clear, nothing (the pill never falls back onto the page) */
export function pickPillSlot(
  current: Rect | null,
  slots: Rect[],
  blocked: (r: Rect) => number,
): Rect | null {
  if (current && blocked(current) === 0) return current;
  for (const s of slots) {
    if (blocked(s) === 0) return s;
  }
  return null;
}

/** REQ-295 — where the pill goes next. `box` null: nothing is clear at this size and the pill is
 *  not compact yet — show the compact form and plan again. `room` > 0: nothing is clear even
 *  compact — reserve that much under the page and sit bottom-left in it. The pill sits at its
 *  box's top-left and is at least as wide as the box; the full-size box never shrinks while the
 *  page lasts (a shorter status must not move the pill), the compact form takes its own box. */
export function planPill(o: {
  current: Rect | null;
  view: Size;
  size: Size;
  compact: boolean;
  blocked: (r: Rect) => number;
  margin?: number;
}): { box: Rect | null; room: number } {
  const margin = o.margin ?? PILL_MARGIN;
  const fit = reservedBox(o.size);
  const box = o.compact || !o.current ? fit : {
    w: Math.max(fit.w, o.current.width),
    h: Math.max(fit.h, o.current.height),
  };
  const cur = o.current
    ? clampRect({ ...o.current, width: box.w, height: box.h }, o.view, margin)
    : null;
  const pick = pickPillSlot(cur, pillSlots(o.view, box, margin), o.blocked);
  if (pick) return { box: pick, room: 0 };
  if (!o.compact) return { box: null, room: 0 };
  return {
    box: cornerRect("bl", o.view, box, margin),
    room: box.h + 2 * margin,
  };
}

/** the slice of Storage this needs — fakeable in a unit test */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** REQ-295 — the tab's memory for the pill's box (none in SSR or a locked-down browser). It
 *  remembers the pill's PLACE only — never anything about the demo itself (REQ-153 AMENDMENT:
 *  the customer is never asked, so nothing of an answer is kept). */
export function pillStore(): StorageLike | null {
  try {
    const g = globalThis as { sessionStorage?: StorageLike };
    return g.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** REQ-295 — keep the pill's box for this page path (null forgets it) */
export function rememberPillBox(
  store: StorageLike,
  path: string,
  box: Rect | null,
): void {
  try {
    if (box) store.setItem(PILL_BOX_KEY + path, JSON.stringify(box));
    else store.removeItem(PILL_BOX_KEY + path);
  } catch { /* storage full or refused: the pill just picks again */ }
}

/** REQ-295 — the box this page path had, if any */
export function recallPillBox(store: StorageLike, path: string): Rect | null {
  try {
    const raw = store.getItem(PILL_BOX_KEY + path);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const n = (k: string) => typeof o[k] === "number" && Number.isFinite(o[k]);
    if (!o || !n("left") || !n("top") || !n("width") || !n("height")) {
      return null;
    }
    return {
      left: o.left as number,
      top: o.top as number,
      width: o.width as number,
      height: o.height as number,
    };
  } catch {
    return null;
  }
}

/** the slice of CSSStyleDeclaration this needs — fakeable in a unit test */
export interface StyleLike {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
}

/** REQ-295 — reserve `height` px under the page for the pill (the REQ-181 banner way), or none */
export function setPillRoom(
  root: StyleLike,
  body: StyleLike,
  height: number,
): void {
  const h = Math.round(height);
  if (!(h > 0)) {
    clearPillRoom(root, body);
    return;
  }
  root.setProperty(PILL_ROOM_VAR, `${h}px`);
  body.setProperty("padding-bottom", `var(${PILL_ROOM_VAR}, 0px)`);
}

/** REQ-295 — the pill needs no room: the page ends at the window again */
export function clearPillRoom(root: StyleLike, body: StyleLike): void {
  root.removeProperty(PILL_ROOM_VAR);
  body.removeProperty("padding-bottom");
}

/**
 * REQ-295 — the customer's pill box on the stage: scaled and offset like the frame.
 * REQ-372 (demo-loop cycle 2, m8) — and cut to the frame: a pill wider than the customer's view
 * (M6's min-width) must not hang off the phone; `clipped` says something was cut. A box wholly
 * outside the frame draws nothing (null).
 */
export function pillGhost(
  r: Rect,
  fit: {
    left: number;
    top: number;
    s: number;
    width?: number;
    height?: number;
  },
): { box: Rect; clipped: boolean } | null {
  const left = fit.left + r.left * fit.s;
  const top = fit.top + r.top * fit.s;
  const right = left + r.width * fit.s;
  const bottom = top + r.height * fit.s;
  const fr = fit.width === undefined ? Infinity : fit.left + fit.width;
  const fb = fit.height === undefined ? Infinity : fit.top + fit.height;
  const l = Math.max(left, fit.left);
  const t = Math.max(top, fit.top);
  const rr = Math.min(right, fr);
  const bb = Math.min(bottom, fb);
  if (!(rr > l) || !(bb > t)) return null;
  const eps = 0.5;
  return {
    box: { left: l, top: t, width: rr - l, height: bb - t },
    clipped: l - left > eps || t - top > eps || right - rr > eps ||
      bottom - bb > eps,
  };
}

/** REQ-295 — the ghost's box on the stage (REQ-372: clipped to the frame; null: nothing to draw) */
export function pillGhostBox(
  r: Rect,
  fit: {
    left: number;
    top: number;
    s: number;
    width?: number;
    height?: number;
  },
): Rect | null {
  return pillGhost(r, fit)?.box ?? null;
}

/** REQ-372 — the customer's pill runs off their screen (it would be cut, or the stage's copy is) */
export function pillOverflows(r: Rect, view: Size, tolerance = 1): boolean {
  return r.left < -tolerance || r.top < -tolerance ||
    r.left + r.width > view.w + tolerance ||
    r.top + r.height > view.h + tolerance;
}

/** REQ-372 — the pill's status as the stage words it (the presenter's dictionary) */
export function statusKeyOf(s: PillStatus): string {
  return s === "live"
    ? "demoMode.connected"
    : s === "ended"
    ? "demoMode.ended"
    : "demoMode.connecting";
}

/**
 * REQ-300 — a box that covers the whole view is a dialog's backdrop (or a sheet): a pill over it
 * is in the way of the dialog, and a slot over it is no clearer than the current one — so the
 * pill stays put while a dialog is open instead of hopping onto the backdrop.
 */
export function coversView(r: Rect, view: Size, tolerance = 1): boolean {
  return r.left <= tolerance && r.top <= tolerance &&
    r.left + r.width >= view.w - tolerance &&
    r.top + r.height >= view.h - tolerance;
}

/** keep a remembered box on the screen after a resize */
export function clampRect(r: Rect, view: Size, margin = PILL_MARGIN): Rect {
  const maxLeft = Math.max(margin, view.w - margin - r.width);
  const maxTop = Math.max(margin, view.h - margin - r.height);
  return {
    ...r,
    left: Math.min(Math.max(margin, r.left), maxLeft),
    top: Math.min(Math.max(margin, r.top), maxTop),
  };
}

/** the stage pill's distance from the bottom of the window */
export const STAGE_PILL_BOTTOM = 14;
/** air between the frame and the stage pill */
export const STAGE_PILL_GAP = 10;
/** the band under the frame before the pill has been measured */
const STAGE_INSET_FALLBACK = 76;

/** REQ-228 — the room the stage keeps under the frame: what its pill really takes */
export function stageInsetBottom(pillH: number): number {
  return pillH > 0
    ? Math.ceil(pillH) + STAGE_PILL_BOTTOM + STAGE_PILL_GAP
    : STAGE_INSET_FALLBACK;
}
