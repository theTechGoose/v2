/**
 * REQ-228 — where the demo pills go so they never cover the page (demo issue
 * pointer-and-replica-side-effects-m4).
 *
 * The customer's pill is one line. The staff stage keeps the frame out of the band its own pill
 * measures (its height, its offset from the bottom, a gap) instead of a guessed 76 px.
 *
 * REQ-295 (demo-loop cycle 1, M1) — the room is reserved under the page (`setPillRoom`, the
 * REQ-181 way: `--demo-pill-h` on <html>, the body padded by it) and the stage gets the pill's box
 * (`pill` peer message) and draws its ghost.
 *
 * REQ-379 (demo-loop cycle 2, M1 + M6 + M28) — ONE home instead of REQ-295's hunt for a clear slot
 * (it hopped page to page, flipped compact <-> full and came back per path after a reload): the
 * pill sits bottom-left in a band reserved under the page, and the app's shells subtract that band
 * as they do the banner, so nothing of the page is ever under it. It is as wide as its content and
 * never wider than the window minus a margin each side (`pillHome`; nothing measured is written
 * back as a min-width, which grew a 390 px phone's pill to 400 px). Only a dialog whose content
 * lies under the home moves it: to the top-left while that is clear (`dockPill`). The phone's
 * details stay open or closed across a reload (`rememberPillOpen`).
 */
import type { PillFace, PillStatus, Rect } from "./protocol.ts";
export { PILL_LABEL_MAX } from "./protocol.ts";

/** the pill's distance from the screen's edges */
export const PILL_MARGIN = 12;
/** at or below this width the customer's pill shows only its status and End (details on tap) */
export const PILL_COMPACT_MAX_W = 640;
/** REQ-548 (demo-loop cycle 4, p4-p3e) — the customer's pill takes a second row only on the
 *  phone's compact form, while its details are open or End is asking: the question then gets its
 *  own row, so it never squeezes the guide's name (REQ-373) to "A..". At rest the pill stays one
 *  row (a long name is cut, REQ-228); the desktop pill has room for the question on its row. */
export function pillWraps(
  o: { compact: boolean; open: boolean; asking: boolean },
): boolean {
  return o.compact && (o.open || o.asking);
}
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
/** REQ-295 — the room reserved under the page (on <html>, like --banner-h); REQ-379: always, while
 *  a pill is up — the shells subtract it */
export const PILL_ROOM_VAR = "--demo-pill-h";
/** REQ-379 — the band's air above and below the pill (the pill sits in the band, not on the page) */
export const PILL_BAND_GAP = 8;
/** REQ-379 — the tab remembers whether the phone pill's details are open under this key */
export const PILL_OPEN_KEY = "pm-demo-pill:open";

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

/**
 * REQ-379 — the pill's one home: bottom-left, its bottom `gap` above the window's (visible)
 * bottom. Its width is its own (natural) width, never wider than the window minus a margin each
 * side — a stale or inflated measure (M6: 400 px on a 390 px phone) is cut back, never kept. The
 * band reserved under the page (`room`) is the pill's height rounded up to the box step (a status
 * a pixel taller does not move the page) plus the gap above and below it. Nothing but the window
 * and the pill goes in: no current box, no path, no memory — the same on every page and load.
 */
export function pillHome(o: {
  view: Size;
  size: Size;
  margin?: number;
  gap?: number;
}): { box: Rect; room: number } {
  const margin = o.margin ?? PILL_MARGIN;
  const gap = o.gap ?? PILL_BAND_GAP;
  const width = Math.min(
    Math.max(1, o.size.w),
    Math.max(1, o.view.w - 2 * margin),
  );
  const height = Math.max(1, o.size.h);
  return {
    box: { left: margin, top: o.view.h - gap - height, width, height },
    room: reservedBox({ w: width, h: height }).h + 2 * gap,
  };
}

/**
 * REQ-379 — a dialog is up (REQ-300 froze the pill instead, over whatever the dialog put under
 * it): the pill stays home while nothing of the dialog is under it, else docks at the top-left —
 * under the impersonation banner (`top`, its height) — while that is clear.
 * REQ-545 (demo-loop cycle 4, m2) — then the top-right; all three covered: null, and the
 * pill tucks into its edge tab (`placePill`) instead of staying home over the dialog (the Publish
 * confirm, the Add task sheet, the send modal had their fields and buttons under it).
 */
export function dockPill(o: {
  home: Rect;
  view: Size;
  top?: number;
  blocked: (r: Rect) => number;
  margin?: number;
  /** REQ-637 (demo-loop cycle 5, m5) — the dialog's own box (its panel, not the backdrop) */
  dialog?: Rect;
}): Rect | null {
  if (o.blocked(o.home) === 0) return o.home;
  const margin = o.margin ?? PILL_MARGIN;
  const top = (o.top ?? 0) + margin;
  // REQ-637 — first just above the dialog's own box, at its left: the pill stays beside what the
  // customer is reading, never on it (and never under the banner or off the window's top)
  if (o.dialog) {
    const aboveTop = o.dialog.top - PILL_BAND_GAP - o.home.height;
    if (aboveTop >= top) {
      const above = clampRect(
        { ...o.home, top: aboveTop, left: o.dialog.left },
        o.view,
        margin,
      );
      if (above.top === aboveTop && o.blocked(above) === 0) return above;
    }
  }
  const left = clampRect({ ...o.home, top }, o.view, margin);
  if (o.blocked(left) === 0) return left;
  const right = clampRect(
    { ...o.home, top, left: o.view.w - margin - o.home.width },
    o.view,
    margin,
  );
  return o.blocked(right) === 0 ? right : null;
}

/** REQ-545 (demo-loop cycle 4, m2) — the tucked pill: a small tab on the window's left edge.
 *  REQ-637 (demo-loop cycle 5, m5) — a labelled mini-pill, not a 16 px sliver: "● Demo" and an ×
 *  that is End (one tap asks "End for everyone?") */
export const PILL_TAB = { w: 96, h: 32 } as const;
/** REQ-545 — a tab tapped open shows the whole pill this long (a hover: until it leaves) */
export const PILL_PEEK_MS = 6000;

/**
 * REQ-545 — the public pages a customer is sent (/q quote, /i invoice, /co change order).
 * REQ-637 (cycle 5, m5) — in the owner's browser during a demo the whole pill sits on its bottom
 * strip there (minimal): it never folds over the content (only a dialog with nowhere free folds it).
 */
export function isPublicDocPath(path: string): boolean {
  return /^\/(q|i|co)\/[^/]/.test(path);
}

/** REQ-545 — the tab's box: flush with the window's left edge, its foot on the home's foot
 *  (REQ-637: the mini-pill's size) */
export function tabBox(home: Rect): Rect {
  return {
    left: 0,
    top: home.top + home.height - PILL_TAB.h,
    width: PILL_TAB.w,
    height: PILL_TAB.h,
  };
}

/**
 * REQ-545 (demo-loop cycle 4, m2) — where the pill is right now. REQ-379's band only frees
 * the END of a document that scrolls: mid-scroll, what scrolled into the window's bottom strip
 * (tiles, "Export customers (CSV)", a service address, "Registrar un pago…") was under the band
 * and the pill. So the pill YIELDS instead of reserving the strip: with anything of the page under
 * its home it tucks into a small edge tab (`tabBox`) and the band is not painted — the page shows;
 * with the home clear (a shell that subtracts the band, the document's end) it sits home on the
 * painted band. A dialog docks it (`dockPill`: home, top-left, top-right) or, all covered, tucks
 * it. REQ-637 (demo-loop cycle 5, m5) — a dialog docks it above the dialog's own box first
 * (`dialogBox`); on a public document page (`minimal`) it stays whole on its strip (the band),
 * folding only under a dialog with no place free.
 */
export function placePill(o: {
  home: Rect;
  view: Size;
  top?: number;
  dialog: boolean;
  /** REQ-637 — the dialog's own box, when one is up */
  dialogBox?: Rect;
  minimal?: boolean;
  /** false: a pill that never tucks (the ended notice, a message to read and dismiss) — a
   *  dialog still docks it, and with no place free it stays home */
  yields?: boolean;
  blocked: (r: Rect) => number;
}): { box: Rect; tucked: boolean; band: boolean } {
  const yields = o.yields ?? true;
  const tucked = { box: tabBox(o.home), tucked: true, band: false };
  if (o.dialog) {
    const box = dockPill({ ...o, dialog: o.dialogBox });
    if (box) return { box, tucked: false, band: box === o.home };
    return yields ? tucked : { box: o.home, tucked: false, band: true };
  }
  // REQ-637 — a public document page: whole, on its strip, whatever scrolls under it
  if (!yields || o.minimal) return { box: o.home, tucked: false, band: true };
  return o.blocked(o.home) === 0
    ? { box: o.home, tucked: false, band: true }
    : tucked;
}

/**
 * REQ-545 — the customer's band on the stage: window-wide at the foot of their screen,
 * scaled and offset like the frame (the mirror skips the overlay, so the stage draws it — both
 * screens show the same strip). No band (0): nothing.
 */
export function bandGhostBox(
  band: number,
  screen: Size,
  fit: { left: number; top: number; s: number },
): Rect | null {
  const h = Math.min(Math.max(0, band), screen.h);
  if (!(h > 0)) return null;
  return {
    left: fit.left,
    top: fit.top + (screen.h - h) * fit.s,
    width: screen.w * fit.s,
    height: h * fit.s,
  };
}

/** the slice of Storage this needs — fakeable in a unit test */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** REQ-295 — the tab's memory for the pill (none in SSR or a locked-down browser). REQ-379: it
 *  remembers whether the phone pill's details are open, only — never anything about the demo
 *  itself (REQ-153 AMENDMENT: the customer is never asked, so nothing of an answer is kept). */
export function pillStore(): StorageLike | null {
  try {
    const g = globalThis as { sessionStorage?: StorageLike };
    return g.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** REQ-379 — keep whether the phone pill's details are open, for the tab */
export function rememberPillOpen(store: StorageLike, open: boolean): void {
  try {
    if (open) store.setItem(PILL_OPEN_KEY, "1");
    else store.removeItem(PILL_OPEN_KEY);
  } catch { /* storage full or refused: the details just start closed */ }
}

/** REQ-379 — were the phone pill's details open in this tab? (closed when unknown) */
export function recallPillOpen(store: StorageLike): boolean {
  try {
    return store.getItem(PILL_OPEN_KEY) === "1";
  } catch {
    return false;
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
  // REQ-440 (cycle 3, m2) — body padding only frees the END of a scrolling document; scrolling to
  // something (an anchor, focus, scrollIntoView, Page Down) must stop above the band too
  root.setProperty("scroll-padding-bottom", `var(${PILL_ROOM_VAR}, 0px)`);
  body.setProperty("padding-bottom", `var(${PILL_ROOM_VAR}, 0px)`);
}

/** REQ-295 — the pill needs no room: the page ends at the window again */
export function clearPillRoom(root: StyleLike, body: StyleLike): void {
  root.removeProperty(PILL_ROOM_VAR);
  root.removeProperty("scroll-padding-bottom");
  body.removeProperty("padding-bottom");
}

/**
 * REQ-440 (demo-loop cycle 3, m2) — the colour the overlay paints the pill's band with: the first
 * fully opaque background of what is under the band (innermost first, then <html> and <body>), so
 * a document that scrolls goes under the band's edge — as if it ended there — never under the
 * pill. A see-through colour would let the text under the band show; nothing opaque → white.
 */
export function bandBackground(colors: readonly string[]): string {
  for (const c of colors) {
    const v = (c ?? "").trim();
    if (!v || v === "transparent") continue;
    const rgba = v.match(/^rgba\(([^)]*)\)$/);
    if (rgba) {
      const alpha = Number(rgba[1].split(/[\s,/]+/).filter(Boolean)[3]);
      if (!(alpha >= 1)) continue;
    }
    return v;
  }
  return "#fff";
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
 * REQ-430 (demo-loop cycle 3, m4) — what the stage's ghost says: the status in the CUSTOMER's
 * words when their pill sent its label (an older page: the stage's words, `statusKeyOf`); the
 * line unless the phone pill is compact and closed, and then the guide's short name, as the phone
 * shows it.
 *
 * REQ-540 (demo-loop cycle 4, m9) — and the rest of the pill, word for word: the "Demo mode"
 * title (never on the compact phone pill, as on the phone) and End (the stage draws it as a
 * disabled chip; none once the demo ended), in the customer's words when their pill sent them.
 * A pill never heard says nothing.
 */
export function ghostWords(
  face: PillFace,
  t: (key: string) => string,
): {
  title?: string;
  text?: string;
  guide?: string;
  status?: string;
  end?: string;
} {
  const closed = face.compact === true && face.open !== true;
  const heard = face.status !== undefined;
  const status = heard ? face.label || t(statusKeyOf(face.status!)) : undefined;
  return {
    title: heard && face.compact !== true
      ? face.title || t("demoMode.title")
      : undefined,
    text: !closed && face.text ? face.text : undefined,
    guide: closed && face.guide ? face.guide : undefined,
    status,
    end: heard && face.status !== "ended"
      ? face.end || t("demoMode.end")
      : undefined,
  };
}

/**
 * REQ-540 (demo-loop cycle 4, m9) — a new page of the customer joined (onPeerOnline): its pill
 * is still connecting and cannot say so (its face rides the very link that is opening), so the
 * stage's ghost keeps the last pill and says "Connecting…" in the stage's words until the new
 * page's pill speaks — never a blank, never a stale "Connected". An ended demo stays ended.
 * REQ-636 — and untucked (the old page's tuck is not the new page's).
 */
export function pillFaceAwaiting(face: PillFace): PillFace {
  // REQ-636 (cycle 5, m8) — nor is it tucked: the new page decides that (a non-public page starts
  // with the whole pill), so the old page's tab must not linger on the stage
  const { label: _label, tucked: _tucked, ...rest } = face;
  return { ...rest, status: face.status === "ended" ? "ended" : "connecting" };
}

/**
 * REQ-430 — the customer's app dropped (the stage's link is waiting, between tabs or over): the
 * frozen ghost must not keep saying the last "Connected". Its status becomes connecting (ended
 * when the demo ended) and the customer's own label goes — the stage words it until their pill
 * speaks again. No pill heard yet: nothing changes.
 */
export function pillFaceOffline(face: PillFace, link: string): PillFace {
  if (!face.status) return face;
  const { label: _label, ...rest } = face;
  return { ...rest, status: link === "ended" ? "ended" : "connecting" };
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
