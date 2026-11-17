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
/** REQ-379 AMENDMENT 2 (REQ-890 lane, by hand) — and above it, when the WHOLE pill would be wider
 *  than this share of the window (a 501 px pill in a 700 px window: 72 %), it is compact too: no
 *  row of such a window has room for the whole beside the page's controls, so its folded chip
 *  must be placed for the form the peek will show */
export const PILL_WHOLE_MAX_SHARE = 2 / 3;
/** REQ-379 / REQ-379 AMENDMENT 2 — the form the pill takes: compact at or under PILL_COMPACT_MAX_W,
 *  or when the whole pill (`whole`, its measured size; null until it has rendered once) is wider
 *  than PILL_WHOLE_MAX_SHARE of the window. Judged on the WHOLE's size only — judged on the compact's
 *  it would flip back and forth */
export function pillCompactForm(viewW: number, whole: Size | null): boolean {
  return viewW <= PILL_COMPACT_MAX_W ||
    (whole !== null && whole.w > viewW * PILL_WHOLE_MAX_SHARE);
}
/** REQ-548 (demo-loop cycle 4, p4-p3e) — the customer's pill takes a second row only on the
 *  phone's compact form, while its details are open or End is asking: the question then gets its
 *  own row, so it never squeezes the guide's name (REQ-373) to "A..". At rest the pill stays one
 *  row (a long name is cut, REQ-228); the desktop pill has room for the question on its row. */
export function pillWraps(
  o: { compact: boolean; open: boolean; asking: boolean },
): boolean {
  return o.compact && (o.open || o.asking);
}
/** REQ-373/298/821/833 — the customer's details row ("{name} is guiding you", or a restart's
 *  "started a new demo"): the desktop pill always shows it; the phone's compact pill only while
 *  its details are open, a restart line is up, or a join's grace is up (REQ-833, cycle dm2 m6:
 *  without `joined` the compact pill never said who is guiding before it folded) */
export function pillDetailsShown(
  o: { compact: boolean; open: boolean; started: boolean; joined: boolean },
): boolean {
  return !o.compact || o.open || o.started || o.joined;
}
/** REQ-294 — the pills' own font: the app's `--font-body` stack, so a pill reads the same on a
 *  page that loads no app stylesheet (the 404 page), where `font:inherit` fell back to the
 *  browser's default face. REQ-825 — then concrete installed sans faces (Arial, Helvetica)
 *  before the generic, so a machine with no system-ui face and no Inter (the demo's headless
 *  box) never lands on its monospace `sans-serif` mapping. */
export const PILL_FONT =
  '"Inter", system-ui, -apple-system, "Segoe UI", Arial, Helvetica, sans-serif';
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

/**
 * REQ-832 (demo-loop cycle dm2, p1) — what a pill would cover at one point while a dialog is up:
 * the page BENEATH the dialog's backdrop, not the backdrop. `stack` is the point's elements top to
 * bottom (`document.elementsFromPoint`, the demo's own chrome left out). The dialog's own layer
 * (anything above the backdrop) is taken as is (`under: false`); the backdrop and every box that
 * holds it (its fixed wrapper, body, html) are skipped, and the first element after them is the
 * page under the dim (`under: true`). The backdrop alone was too big to count as page
 * (PAGE_BACKDROP_AREA) and is no control, so every spot outside the panel read as clear and the
 * pill sat over the sidebar's Log out (demo 5, the send dialog). No backdrop: the topmost element.
 */
export function pastBackdrop<T>(
  stack: readonly T[],
  backdrop: T | null,
  holds: (outer: T, inner: T) => boolean,
): { el: T; under: boolean } | undefined {
  let under = false;
  for (const el of stack) {
    if (backdrop !== null && (el === backdrop || holds(el, backdrop))) {
      under = true;
      continue;
    }
    return { el, under };
  }
  return undefined;
}

/** REQ-898 — the boxes whose CENTRE lies in `r` (their indices). The sampling grid (`samplePoints`:
 *  a point every 40 px across, three rows) misses a control smaller than its pitch — the
 *  dashboard's 10 px money-bar segments, a 24 px footer link between the rows of a 74 px asking
 *  pill — so the page's controls are also looked up by their centre */
export function centresIn(boxes: readonly Rect[], r: Rect): number[] {
  const out: number[] = [];
  boxes.forEach((b, i) => {
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    if (
      cx >= r.left && cx < r.left + r.width && cy >= r.top &&
      cy < r.top + r.height
    ) out.push(i);
  });
  return out;
}

/** REQ-898 AMENDMENT (dm8, p4) — the boxes that share area with `r` while their centre is outside
 *  it (`centresIn` has the rest): a control the pill merely touches — the compact peek pill's top
 *  1.4 px over the "Nuevo cliente" button's bottom at 390 px, no grid point on that sliver */
export function edgesIn(boxes: readonly Rect[], r: Rect): number[] {
  const out: number[] = [];
  boxes.forEach((b, i) => {
    if (!rectsOverlap(b, r)) return;
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const centreIn = cx >= r.left && cx < r.left + r.width && cy >= r.top &&
      cy < r.top + r.height;
    if (!centreIn) out.push(i);
  });
  return out;
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
/** REQ-897 (demo-loop cycle dm6, p4) — a heading under a box counts this many pieces of the page
 *  in the overlay's `blocked` count: with text under every tab spot the folded chip takes the
 *  least-covered one, and a title ("Termina la configuración — faltan 5 cosas") is never it */
export const HEADING_SELECTOR = "h1,h2,h3,[role='heading']";
export const HEADING_WEIGHT = 3;
/** REQ-897 (cycle dm6, p5) — a scroll is over this long after its last event: the folded chip
 *  holds its spot while the page scrolls and is judged against what is under it only once the
 *  scroll has settled — not hopping edge to edge as lines (on /settings: a field every row) pass */
export const PILL_SCROLL_SETTLE_MS = 250;

/**
 * REQ-820 (demo-loop cycle dm1, m6 + test-setup-m4) — the peek's fold timer. When it fires the
 * pill folds, unless it is HELD (a mouse or pen pointer on it, or End's question up): then it
 * waits again. A pointer resting on the pill keeps it whole however long it rests; only leaving
 * it (the caller arms a short wait) folds it.
 */
export function peekTimer(o: {
  held: () => boolean;
  fold: () => void;
}): { arm: (ms: number) => void; cancel: () => void } {
  let id: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => clearTimeout(id);
  const arm = (ms: number) => {
    cancel();
    id = setTimeout(() => {
      id = undefined;
      if (o.held()) arm(ms);
      else o.fold();
    }, ms);
  };
  return { arm, cancel };
}

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

/** REQ-781 (demo-loop cycle dv1, d7) — the mini-pill's places, in the order asked: flush with the
 *  window's left edge with its foot on the home's foot (`tabBox`), then flush with the right edge;
 *  then up both edges a tab's height (and a gap) at a time, down to `top` (the banner).
 *  REQ-818 (demo-loop cycle dm1, m5) — then along the bottom edge, a tab's width (and a gap) at a
 *  time from left to right: a page with controls up both edges (a sidebar, a right rail) still has
 *  a place with no control under the mini-pill */
export function tabSpots(home: Rect, view: Size, top = 0): Rect[] {
  const left = tabBox(home);
  const right = Math.max(0, view.w - PILL_TAB.w);
  const out: Rect[] = [];
  for (
    let t = left.top;
    t >= top + PILL_MARGIN;
    t -= PILL_TAB.h + PILL_BAND_GAP
  ) {
    out.push({ ...left, top: t }, { ...left, top: t, left: right });
  }
  if (!out.length) out.push(left, { ...left, left: right });
  const step = PILL_TAB.w + PILL_BAND_GAP;
  for (let x = step; x + PILL_TAB.w <= right - PILL_BAND_GAP; x += step) {
    out.push({ ...out[0], left: x });
  }
  return out;
}

/** REQ-818 (demo-loop cycle dm1, m5) — the box with the fewest controls under it; a tie keeps the
 *  first (the order asked) */
function fewest(boxes: Rect[], controls: (r: Rect) => number): Rect {
  let best = boxes[0];
  let n = Infinity;
  for (const r of boxes) {
    const c = controls(r);
    if (c < n) {
      best = r;
      n = c;
      if (c === 0) break;
    }
  }
  return best;
}

/**
 * REQ-818 (demo-loop cycle dm1, m5) — the whole pill shown out of its mini-pill (`tab`, a hover or
 * a tap): on the tab's row (its foot on the tab's foot), flush with the tab's edge (centred over a
 * tab along the bottom) — so the pointer that opened it is on it — unless a control is under it there: then slid along the row to the
 * place with the fewest controls, nearest that edge first. Always inside the window.
 * REQ-849 (demo-loop cycle dm3, p14) — kept PILL_MARGIN from either window edge, like every other
 * spot (`pillSpots`): a peek flush with the right edge read as a pill pressed against it while the
 * top-right one kept 12 px. The pointer that opened it may then be in the gap, on the tab's old
 * box: `peekHolds` counts that box as part of the pill, so it does not fold.
 * REQ-873 (demo-loop cycle dm5, p5) — a row with a control under every x (/customers at 700 wide:
 * a 501 px pill can only range over 12..187, and each box spans the filter tabs at 261..535): the
 * rows above and below, a pill height plus PILL_BAND_GAP apart, nearest the tab's row first (as
 * `pillRows` / `askSpot`), then `pillSpots`; the first with no control under it. None clear: the
 * row's fewest, as before. Wherever it opens, `peekHolds` still counts the tab's box as the pill's.
 */
/** REQ-890 — how long after the pointer was last on the tab or the pill its way between them is
 *  not a leave (a peek that opened away from the tab is reached, not folded on the way) */
export const PEEK_TRAVEL_MS = 1500;

/** REQ-890 — a peek's box: `compact` when it is the compact form's, `crowded` when no form had a
 *  control-free box and this is the row's fewest */
export type PeekBox = Rect & { compact?: boolean; crowded?: boolean };

/**
 * REQ-890 AMENDMENT 2 — the peek's box flush with a tab spot: its foot on the tab's foot, at the
 * left margin for a left-edge tab, the right margin for a right-edge one, centred over a tab along
 * the bottom; inside the window (a pill wider than that: at the left margin). The same box
 * `peekBox` tries first, so `placePill` can judge a spot by what its peek would cover there.
 */
export function peekFlushBox(tab: Rect, view: Size, size: Size): Rect {
  const min = PILL_MARGIN;
  const max = Math.max(min, view.w - PILL_MARGIN - size.w);
  const top = tab.top + tab.height - size.h;
  const left = tab.left <= 0
    ? min
    : tab.left + tab.width >= view.w
    ? max
    : Math.max(
      min,
      Math.min(Math.round(tab.left + (tab.width - size.w) / 2), max),
    );
  return { left, top, width: size.w, height: size.h };
}

export function peekBox(o: {
  home: Rect;
  view: Size;
  tab: Rect;
  /** REQ-890 — the pill's compact form (the ≤640 px one), tried on the tab's row before the whole
   *  pill moves to another row; unknown until it has been rendered once */
  compact?: Size;
  /** REQ-816 — the left edge's tab spot (`tabBox(home)`); the tab's own box already says which
   *  edge it is on, so it is not needed (kept for the REQ-816 callers) */
  edge?: Rect;
  /** REQ-818 — controls under a box; none counted when absent (flush with the tab's edge) */
  controls?: (r: Rect) => number;
  /** REQ-890 AMENDMENT 3 (dm14, m2) — words (text, media) under a box: with it, a box clear of
   *  controls AND words is taken first — the tab's row, the other rows, the pill's spots — and
   *  only when there is none does the old rule (controls alone) answer. The peek with its details
   *  open (two rows) sat on "Step 2 of 10" on the tab's row, the rows below clear */
  texts?: (r: Rect) => number;
  /** REQ-873 — the impersonation banner's height: no row or spot above it */
  top?: number;
}): PeekBox {
  const controls = o.controls ?? (() => 0);
  if (o.texts) {
    const texts = o.texts;
    const clear = run((r) => controls(r) * 1000 + texts(r), false);
    if (clear) return clear;
  }
  return run(controls, true)!;
  /** one pass of the search with `count` as what blocks a box: a clear box (count 0) on the tab's
   *  row, the compact form's there, another row or spot; `fallback` — else the row's fewest */
  function run(
    count: (r: Rect) => number,
    fallback: boolean,
  ): PeekBox | null {
    /** the search for one form of the pill (`home` is its box): the tab's row along x, flush with
     *  the tab first; then (`more`) the other rows, nearest first, and the pill's spots */
    function search(home: Rect) {
      // REQ-849 — inside the margins (a pill wider than that: at the left margin); at the left
      // edge's margin, or the right one's; a tab along the bottom: centred over it (`peekFlushBox`)
      const min = PILL_MARGIN;
      const max = Math.max(min, o.view.w - PILL_MARGIN - home.width);
      const first = peekFlushBox(o.tab, o.view, {
        w: home.width,
        h: home.height,
      });
      const top = first.top;
      const flush = first.left;
      const at = (x: number): Rect => ({
        ...home,
        top,
        left: Math.max(min, Math.min(Math.round(x), max)),
      });
      const xs = [flush];
      for (let x = min; x < max; x += PILL_TAB.w / 2) xs.push(x);
      xs.push(max);
      xs.sort((a, b) => Math.abs(a - flush) - Math.abs(b - flush));
      const best = fewest(xs.map(at), count);
      const row = count(best) === 0 ? best : null;
      // REQ-873 — the row is crowded: other rows (between the banner and home's row), nearest
      // first, each along x as above; then the pill's spots
      const more = (): Rect | null => {
        const ceil = (o.top ?? 0) + PILL_MARGIN;
        const floor = Math.max(top, home.top);
        const step = home.height + PILL_BAND_GAP;
        const rows: number[] = [];
        for (
          let k = 1; top - k * step >= ceil || top + k * step <= floor; k++
        ) {
          if (top - k * step >= ceil) rows.push(top - k * step);
          if (top + k * step <= floor) rows.push(top + k * step);
        }
        for (const t of rows) {
          for (const x of xs) {
            const r = { ...at(x), top: t };
            if (count(r) === 0) return r;
          }
        }
        for (const r of pillSpots({ home, view: o.view, top: o.top })) {
          if (count(r) === 0) return r;
        }
        return null;
      };
      return { best, row, more };
    }
    const whole = search(o.home);
    if (whole.row) return whole.row;
    // REQ-890 — the whole pill has no clear box on the tab's row: the compact form there, before
    // the whole pill moves away from the tab
    const compact = o.compact
      ? search({ ...o.home, width: o.compact.w, height: o.compact.h })
      : null;
    if (compact?.row) return { ...compact.row, compact: true };
    const away = whole.more();
    if (away) return away;
    const awayCompact = compact?.more();
    if (awayCompact) return { ...awayCompact, compact: true };
    return fallback ? { ...whole.best, crowded: true } : null;
  }
}

/**
 * REQ-849 (demo-loop cycle dm3, p14) — the peek is held while the pointer is on the pill OR on the
 * tab's box it opened from: the peek keeps PILL_MARGIN from the edge, so a pointer that opened it
 * on the tab's outer part sits in the gap, and folding there would only open it again. `tab` null
 * (no tab placed) or a pointer never seen (NaN): only the pill counts.
 */
export function peekHolds(o: {
  pill: Rect;
  tab: Rect | null;
  x: number;
  y: number;
  /** REQ-890 — when the pointer was last on the tab or the pill, and the time now: within
   *  PEEK_TRAVEL_MS the corridor between the tab and the pill (their union) holds it too, for the
   *  pointer on its way to a peek that opened away from the tab */
  since?: number;
  now?: number;
}): boolean {
  const inside = (r: Rect) =>
    o.x >= r.left && o.x <= r.left + r.width && o.y >= r.top &&
    o.y <= r.top + r.height;
  if (inside(o.pill) || (o.tab !== null && inside(o.tab))) return true;
  if (
    o.tab !== null && o.since !== undefined &&
    (o.now ?? Date.now()) - o.since < PEEK_TRAVEL_MS
  ) {
    const left = Math.min(o.pill.left, o.tab.left);
    const top = Math.min(o.pill.top, o.tab.top);
    return inside({
      left,
      top,
      width: Math.max(o.pill.left + o.pill.width, o.tab.left + o.tab.width) -
        left,
      height: Math.max(o.pill.top + o.pill.height, o.tab.top + o.tab.height) -
        top,
    });
  }
  return false;
}

/**
 * REQ-781 (demo-loop cycle dv1, d7) — where the whole pill may float, in the order asked: its home
 * (bottom-left), the bottom-right, the bottom-centre, the top-right and the top-left (under the
 * impersonation banner, `top`). All inside the window.
 */
export function pillSpots(o: {
  home: Rect;
  view: Size;
  top?: number;
  margin?: number;
}): Rect[] {
  const margin = o.margin ?? PILL_MARGIN;
  const top = (o.top ?? 0) + margin;
  const w = o.home.width;
  // across, kept a margin inside the window; down, the home's own foot (its band gap) or the top
  const at = (left: number, t: number) => ({
    ...o.home,
    left: Math.max(margin, Math.min(left, o.view.w - margin - w)),
    top: t,
  });
  return [
    o.home,
    at(o.view.w - margin - w, o.home.top),
    at(Math.round((o.view.w - w) / 2), o.home.top),
    at(o.view.w - margin - w, top),
    at(o.home.left, top),
  ];
}

/**
 * REQ-866 (demo-loop cycle dm4, m2b) — the whole pill's rows between its home row and the top
 * one, from home's row up; each at the left edge (home's), the right edge, then centred. Tried
 * only when every `pillSpots` box holds a control and the pill may not fold.
 * REQ-866 AMENDMENT (demo-loop run 11, m2) — every HALF of a pill height plus a gap (they were a
 * whole one apart, as `tabSpots`): on /welcome at 390 px no whole-step row was clear and the join
 * grace's pill sat on the question and its hint, while the 73 px band between the skip button and
 * the footer's links — between two of those rows — was clear.
 */
export function pillRows(o: {
  home: Rect;
  view: Size;
  top?: number;
  margin?: number;
}): Rect[] {
  const margin = o.margin ?? PILL_MARGIN;
  const top = (o.top ?? 0) + margin;
  const w = o.home.width;
  const step = (o.home.height + PILL_BAND_GAP) / 2;
  const lefts = [
    o.home.left,
    o.view.w - margin - w,
    Math.round((o.view.w - w) / 2),
  ].map((l) => Math.max(margin, Math.min(l, o.view.w - margin - w)));
  const out: Rect[] = [];
  for (let t = o.home.top - step; t > top; t -= step) {
    for (const left of new Set(lefts)) out.push({ ...o.home, left, top: t });
  }
  return out;
}

/**
 * REQ-866 AMENDMENT 2 (demo-loop run 12, m1) — the clear bands the page's blocks leave, for a pill
 * that may not fold: `pillRows` steps by half a pill from home, and a band that is not on that
 * grid is missed — on the English /welcome step 2 at 390 px the 53 px between Continue (600) and
 * "Skip setup for now" (653) held a 43 px pill with 5 px to spare, and no half-step row (610.5,
 * 636, …) fit it, so the pill sat on the hint. Here the page itself is read: `hit(x, y)` says
 * whether a piece of the page is at a point; a few columns across the pill's width are walked every
 * `step` px from home's foot up to `top`, and every run of clear rows tall enough for the pill
 * gives one box, the pill centred in it — nearest home first, at home's left, the right edge,
 * then centred (as `pillRows`). The caller judges each box with `blocked` as it does a row.
 * `hit` is what a pill may not sit on when a clear spot exists — text, a control, media — not a
 * painted container: a card's empty padding is a band (the 53 px under Continue is the card's
 * foot), and `placePill` takes it before any text when nothing is clear.
 */
export function pillBands(o: {
  home: Rect;
  view: Size;
  top?: number;
  margin?: number;
  /** text, a control or media is at this point (a painted container alone is not) */
  hit: (x: number, y: number) => boolean;
  /** how far apart the rows read are (px) */
  step?: number;
}): Rect[] {
  const margin = o.margin ?? PILL_MARGIN;
  const top = (o.top ?? 0) + margin;
  const w = o.home.width;
  const h = o.home.height;
  // REQ-866 AMENDMENT 2 — measured on /settings at 390×844: 9 columns every 4 px cost 32–42 ms
  // a placement (the page's main thread, every measure of the join grace); 5 columns every 8 px
  // cost 8–10 ms. The caller judges each band with `blocked` anyway
  const step = o.step ?? 8;
  const lefts = [
    o.home.left,
    o.view.w - margin - w,
    Math.round((o.view.w - w) / 2),
  ].map((l) => Math.max(margin, Math.min(l, o.view.w - margin - w)));
  const found: { box: Rect; order: number; dist: number }[] = [];
  let order = 0;
  for (const left of new Set(lefts)) {
    // a column every 80 px or so across the pill, 6 px in from each end
    const cols = Math.max(3, Math.ceil(w / 80));
    const xs = Array.from(
      { length: cols },
      (_, i) => left + 6 + ((w - 12) * i) / (cols - 1),
    );
    // walk up from home's foot; a run of clear rows is a band
    let runBottom: number | null = null;
    const band = (bottom: number, topEdge: number) => {
      const tall = bottom - topEdge;
      if (tall < h) return;
      const t = Math.round((topEdge + (tall - h) / 2) * 10) / 10;
      found.push({
        box: { ...o.home, left, top: t },
        order: order++,
        dist: Math.abs(o.home.top - t),
      });
    };
    for (let y = o.home.top + h; y >= top; y -= step) {
      const clear = !xs.some((x) => o.hit(x, y));
      if (clear) {
        if (runBottom === null) runBottom = y + step;
      } else if (runBottom !== null) {
        band(runBottom, y + 1);
        runBottom = null;
      }
    }
    if (runBottom !== null) band(runBottom, top);
  }
  found.sort((a, b) => a.dist - b.dist || a.order - b.order);
  return found.map((f) => f.box);
}

/**
 * REQ-545 (demo-loop cycle 4, m2) — where the pill is right now: it yields to the page, folding
 * to a mini-pill (REQ-637) rather than sitting over it; a dialog docks it (`dockPill`).
 * REQ-781 (demo-loop cycle dv1, d7) — Raphael: "the gap reserved for the demo pill ... that's not
 * a decision". No band is ever kept under the page for it (REQ-379/440/643's room is gone): the
 * pill floats over the page, never on a band (`band` is always false). In order:
 *   1. whole, in the first spot (`pillSpots`) with nothing of the page under it (`blocked`);
 *   2. a pill that yields: folded to its mini-pill at an edge (`tabSpots`) with no control under
 *      it (`controls`; defaults to `blocked`);
 *      REQ-853 (demo-loop cycle dm3, p1 + p8; amends REQ-228/781): the mini-pill avoids text — a
 *      tab spot with NOTHING of the page under it (`blocked`) before one with only no control —
 *      and keeps the spot it has (`keep`: the current or carried one) while that is still as
 *      clear, so a page that changes under it (a skeleton swapped for data) does not make it hop;
 *   3. whole, in the first spot with no control under it (text and cards may be);
 *   4. folded at the left edge (a pill that yields, or a public /q /i /co page), else home.
 *      REQ-818 (cycle dm1, m5): not the left edge blindly — the mini-pill or whole spot with the
 *      fewest controls under it.
 * A public document page (`minimal`) prefers the whole pill (End in reach): 1, 3, then 2. The
 * ended notice (`floats`) and a pill that does not yield never fold: 1, then (REQ-874, cycle dm5,
 * p9) a row between (`pillRows`) with nothing of the page under it — never over the footer's
 * address while a row is clear — then 3, else (REQ-866, cycle dm4, m2b) the whole spot with the
 * fewest controls under it — home only when none has fewer.
 */
export function placePill(o: {
  home: Rect;
  view: Size;
  top?: number;
  dialog: boolean;
  /** REQ-637 — the dialog's own box, when one is up */
  dialogBox?: Rect;
  minimal?: boolean;
  /** false: a pill that never tucks (a message to read and dismiss) — a dialog still docks it,
   *  and with no place free of controls it takes the one with the fewest (REQ-866) */
  yields?: boolean;
  /** REQ-643 (demo-loop cycle 5, m9) — a floating message (the ended notice): never folded */
  floats?: boolean;
  /** how many pieces of the page (controls, media, text, cards) are under a box */
  blocked: (r: Rect) => number;
  /** REQ-781 — how many controls of the page (links, buttons, fields) are under a box */
  controls?: (r: Rect) => number;
  /** REQ-853 (cycle dm3, p8) — the mini-pill's spot now (or carried from the last page): kept
   *  while it is as clear as the best other spot. Ignored unless it is one of `tabSpots` */
  keep?: Rect;
  /** REQ-897 (cycle dm6, p5) — the page is scrolling: the kept spot stays (what passes under it
   *  is judged once the scroll has settled, PILL_SCROLL_SETTLE_MS after its last event) */
  scrolling?: boolean;
  /** REQ-866 AMENDMENT 2 (dm12, m1) — the clear bands the page's blocks leave (`pillBands`), read
   *  only when a pill that may not fold finds no clear row: the first with nothing under it */
  bands?: () => Rect[];
  /** REQ-890 AMENDMENT 2 — the sizes the peek out of the folded chip could show (the whole pill,
   *  and its compact form once known): among equally clear tab spots, one whose flush peek box
   *  (`peekFlushBox`) covers no control for some size is preferred, so a hover opens the pill
   *  flush with the chip instead of rows away. Absent (or during a peek): no preference */
  peek?: Size[];
}): { box: Rect; tucked: boolean; band: boolean } {
  // REQ-818 — each box is measured once (the last resort asks of every spot again)
  const counted = new Map<string, number>();
  const controls = (r: Rect) => {
    const k = `${r.left},${r.top},${r.width},${r.height}`;
    let n = counted.get(k);
    if (n === undefined) {
      n = (o.controls ?? o.blocked)(r);
      counted.set(k, n);
    }
    return n;
  };
  // REQ-853 — and what of the page is under it, once (the tab spots are asked it now too)
  const seen = new Map<string, number>();
  const blocked = (r: Rect) => {
    const k = `${r.left},${r.top},${r.width},${r.height}`;
    let n = seen.get(k);
    if (n === undefined) {
      n = o.blocked(r);
      seen.set(k, n);
    }
    return n;
  };
  const whole = (box: Rect) => ({ box, tucked: false, band: false });
  const fold = (box: Rect) => ({ box, tucked: true, band: false });
  const folds = !o.floats && (o.yields ?? true);
  const tabs = tabSpots(o.home, o.view, o.top);
  // REQ-853 (demo-loop cycle dm3, p1 + p8) — the mini-pill's spot: the kept one if nothing of the
  // page is under it, else the first with nothing under it (never over the footer's address line);
  // REQ-897 (cycle dm6, p4 + p5) — else, among the spots with no control under them (REQ-781),
  // the one with the LEAST of the page under it (a heading weighs HEADING_WEIGHT; a tie keeps the
  // spots' order) — the kept one while it is as clear as that. While the page scrolls the kept spot
  // holds: what passes under it (on /settings a field every row: no spot is clear for long) is
  // judged once the scroll has settled — a finger on the page is scrolling, not tapping
  const kept = o.keep &&
    tabs.find((r) => r.left === o.keep!.left && r.top === o.keep!.top);
  // REQ-890 AMENDMENT 2 — a spot its peek can open flush from: some form's flush box covers no
  // control there (no sizes offered: every spot is). Asked only as far as the search needs
  const peekable = (r: Rect) =>
    !o.peek || o.peek.length === 0 ||
    o.peek.some((s) => controls(peekFlushBox(r, o.view, s)) === 0);
  const tab = () => {
    if (o.scrolling && kept) return kept;
    const clear = tabs.filter((r) => blocked(r) === 0);
    // REQ-853 — the kept spot while it is clear; REQ-890 AMENDMENT 2 — unless its peek cannot
    // open flush and another clear spot's can
    if (
      kept && blocked(kept) === 0 &&
      (peekable(kept) || !clear.some(peekable))
    ) return kept;
    const first = clear.find(peekable) ?? clear[0];
    if (first) return first;
    const open = tabs.filter((r) => controls(r) === 0);
    if (open.length === 0) return undefined;
    // REQ-897 — the least of the page under it; REQ-890 AMENDMENT 2 — among the peekable ones
    // when there are any
    const flush = open.filter(peekable);
    const least = fewest(flush.length ? flush : open, blocked);
    return kept && controls(kept) === 0 && blocked(kept) <= blocked(least) &&
        (peekable(kept) || !peekable(least))
      ? kept
      : least;
  };
  // REQ-866 (demo-loop cycle dm4, m2b) — a pill that may not fold (REQ-821's join grace, REQ-298's
  // restart line, the ended notice) with no pillSpot free of controls: never home blindly — that
  // was the sidebar's Log out on /customers at 1280×800, where every pillSpot holds 3 controls
  // (the sidebar's foot and the footer links below, the topbar above). The rows between
  // (`pillRows`): the first with nothing of the page under it, else the first with no control;
  // else the box with the FEWEST controls (tied, the least of the page; then the earlier, home)
  const standing = (spots: Rect[]) => {
    const rows = pillRows(o);
    // REQ-866 AMENDMENT 2 (dm12, m1) — a clear band off the rows' grid before a row over text;
    // and with nothing clear, the control-free band or row with the LEAST of the page under it
    // (a card's empty padding, 1, before the hint's text on the card, 2) — not the first
    // control-free row blindly, which was the language hint on the English /welcome at 390
    const bands = o.bands?.() ?? [];
    const free = rows.find((r) => blocked(r) === 0) ??
      bands.find((r) => blocked(r) === 0);
    if (free) return free;
    const open = [...bands, ...rows].filter((r) => controls(r) === 0);
    if (open.length) return fewest(open, blocked);
    const all = [...spots, ...rows];
    let best = all[0];
    for (const r of all.slice(1)) {
      const d = controls(r) - controls(best);
      if (d < 0 || (d === 0 && blocked(r) < blocked(best))) best = r;
    }
    return best;
  };
  if (o.dialog) {
    const box = dockPill({ ...o, dialog: o.dialogBox });
    if (box) return whole(box);
    if (!folds) {
      const spots = pillSpots(o);
      return whole(spots.find((r) => controls(r) === 0) ?? standing(spots));
    }
    // REQ-818 (cycle dm1, m5) — no tab spot clear: the one with the fewest controls, not tabs[0]
    return fold(tab() ?? fewest(tabs, controls));
  }
  const spots = pillSpots(o);
  const free = spots.find((r) => blocked(r) === 0);
  if (free) return whole(free);
  if (folds && !o.minimal) {
    const t = tab();
    if (t) return fold(t);
  }
  // REQ-874 (demo-loop cycle dm5, p9) — a pill that does not fold takes a row with nothing of the
  // page under it before a spot with only text under it: the ended notice sat bottom-right over
  // /admin's footer address ("45…" cut off) while the row above was clear
  if (!folds) {
    const row = pillRows(o).find((r) => blocked(r) === 0) ??
      // REQ-866 AMENDMENT 2 (dm12, m1) — else a clear band the page's blocks leave
      o.bands?.().find((r) => blocked(r) === 0);
    if (row) return whole(row);
  }
  const clear = spots.find((r) => controls(r) === 0);
  if (clear) return whole(clear);
  if (!folds) return whole(standing(spots));
  // REQ-818 (demo-loop cycle dm1, m5) — nothing without a control: the mini-pill or whole spot with
  // the FEWEST controls (a tie keeps the mini-pill, in its order), never tabs[0] blindly — that was
  // the sidebar's Log out button at 1280×800
  const t = tab();
  if (t) return fold(t);
  const best = fewest([...tabs, ...spots], controls);
  return tabs.includes(best) ? fold(best) : whole(best);
}

/**
 * REQ-816 (demo-loop cycle dm1, M1) — the pill grown where it stands (End's question, the phone's
 * wrapped second row) kept inside the window: anchored on its left and its foot, it grows right and
 * up, so a pill placed from the right edge (`peekBox`, the bottom-right / top-right `pillSpots`)
 * ran past the right edge with "Yes, end it" off-screen. Its right edge is pulled to the margin
 * and its top kept under the top margin; a pill that already fits does not move (a left-edge peek
 * stays at its margin, REQ-849).
 */
export function keepInView(r: Rect, view: Size, margin = PILL_MARGIN): Rect {
  let left = r.left;
  if (left + r.width > view.w - margin) {
    left = Math.max(Math.min(r.left, margin), view.w - margin - r.width);
  }
  const top = r.top < margin ? margin : r.top;
  return left === r.left && top === r.top ? r : { ...r, left, top };
}

/**
 * REQ-835 (demo-loop cycle dm2, M2; amends REQ-816 / REQ-228) — the asking pill kept in view at
 * its size now: anchored at left PILL_MARGIN and its foot PILL_BAND_GAP above the visible bottom,
 * shifted by `dock`. Run when End's question comes up AND on every re-place while it is up (a
 * resize, the check interval, a scroll), so a window narrowed under the question pulls it back in.
 * REQ-300 still holds: a pill that fits keeps its dock (the same object) and does not move.
 * `fit` is the box it is laid out in with the returned dock.
 */
export function askDock(o: {
  view: Size;
  dock: { x: number; y: number };
  size: Size;
}): { dock: { x: number; y: number }; fit: Rect } {
  const foot = o.view.h - PILL_BAND_GAP + o.dock.y;
  const r = {
    left: PILL_MARGIN + o.dock.x,
    top: foot - o.size.h,
    width: o.size.w,
    height: o.size.h,
  };
  const fit = keepInView(r, o.view);
  if (fit === r) return { dock: o.dock, fit };
  const dock = {
    x: Math.round(fit.left - PILL_MARGIN),
    y: Math.round(o.dock.y + (fit.top - r.top)),
  };
  return {
    dock,
    fit: {
      ...fit,
      left: PILL_MARGIN + dock.x,
      top: foot - o.size.h + (dock.y - o.dock.y),
    },
  };
}

/** REQ-876 (demo-loop cycle dm5, m2) — the width the asking pill's answers ("Yes, end it" +
 *  "Keep going") take at its right end, when the island has not measured them */
export const ASK_ANSWERS_W = 150;

/** REQ-876 — the gap between two boxes (0 when they touch or overlap) */
function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(
    0,
    b.left - (a.left + a.width),
    a.left - (b.left + b.width),
  );
  const dy = Math.max(
    0,
    b.top - (a.top + a.height),
    a.top - (b.top + b.height),
  );
  return Math.hypot(dx, dy);
}

/**
 * REQ-852 (demo-loop cycle dm3, p4; amends REQ-228 / REQ-835) — where End's question opens: the
 * asking pill at its asking `size`, placed once where no CONTROL of the page is under it. It grew
 * in place and REQ-835's clamp only pulled it back inside the window, so a 444 px pill at the
 * top-right grew to 671 px over /welcome's centred brand link. Tried in order: the current anchor;
 * the same row anchored at the opposite edge (then the near one); the bottom row (home, then the
 * bottom-right). The first with no control under it, else the fewest (a tie keeps the earlier).
 * Each is laid out by `askDock`, so REQ-835's in-view clamp is the last step; a clear current
 * anchor returns askDock's own result (a pill that fits keeps the same dock: REQ-300).
 * REQ-876 (demo-loop cycle dm5, m2) — with `near` (where End was pressed), the first clear box was
 * ~630 px from the press (/welcome: x823 y12 → x12 y63): the boxes are ranked by how far their
 * answers are from the press, the anchor's row and the rows next to it slid in PILL_TAB.w/2 steps
 * too, and the nearest with the fewest controls wins. No control under it stays the rule.
 */
export function askSpot(o: {
  view: Size;
  dock: { x: number; y: number };
  size: Size;
  /** how many controls of the page are under a box */
  controls: (r: Rect) => number;
  /** REQ-876 — where End was pressed (its button's box, or the press point as a 0×0 box): among
   *  the boxes with the fewest controls, the one whose answers are nearest it wins */
  near?: Rect;
  /** REQ-876 — the answers' box inside the asking pill (relative to its left/top); absent, the
   *  pill's right end (ASK_ANSWERS_W wide) stands for them */
  answers?: Rect;
}): { dock: { x: number; y: number }; fit: Rect; controls: number } {
  const at = (dock: { x: number; y: number }) =>
    askDock({ view: o.view, dock, size: o.size });
  const here = at(o.dock);
  // dock.x that puts the pill's left edge at the margin, or its right edge at the margin
  const leftX = 0;
  const rightX = o.view.w - 2 * PILL_MARGIN - o.size.w;
  const onRight = here.fit.left + here.fit.width / 2 > o.view.w / 2;
  const row = here.dock.y;
  const midX = Math.round((o.view.w - o.size.w) / 2) - PILL_MARGIN;
  const tries = function* () {
    yield here;
    yield at({ x: onRight ? leftX : rightX, y: row });
    yield at({ x: onRight ? rightX : leftX, y: row });
    yield at({ x: leftX, y: 0 });
    yield at({ x: rightX, y: 0 });
    // REQ-866 (demo-loop cycle dm4, m2) — every one of those can hold a control (/welcome: the
    // centred brand in the top row, the footer's centred phone link in the bottom one): a centred
    // box in those two rows, then the rows between, a pill height plus a gap apart (as tabSpots),
    // nearest the anchor's row first, each at the anchor's side, the other side, then centred
    yield at({ x: midX, y: row });
    yield at({ x: midX, y: 0 });
    const step = o.size.h + PILL_BAND_GAP;
    // dock.y of the top row: the pill's top at the margin
    const topY = PILL_MARGIN + o.size.h - (o.view.h - PILL_BAND_GAP);
    const rows: number[] = [];
    for (let k = 1; row - k * step > topY || row + k * step < 0; k++) {
      // a step down (the foot lower), then a step up, from the anchor's row
      if (row + k * step < 0) rows.push(row + k * step);
      if (row - k * step > topY) rows.push(row - k * step);
    }
    for (const y of rows) {
      yield at({ x: onRight ? rightX : leftX, y });
      yield at({ x: onRight ? leftX : rightX, y });
      yield at({ x: midX, y });
    }
  };
  const seen = new Set<string>();
  let best = here;
  let n = Infinity;
  if (o.near) {
    // REQ-876 (demo-loop cycle dm5, m2) — End's press known: a clear anchor still stays (REQ-300);
    // else every box (REQ-852/866's, rows a third of a step apart, and the anchor's row and the
    // rows within a step of it slid from the anchor's edge in PILL_TAB.w/2 steps) is ranked by how far its answers are from the press and
    // counted nearest first — the first with no control wins, else the fewest (a tie: the nearest)
    const near = o.near;
    const a = o.answers ?? {
      left: Math.max(0, o.size.w - ASK_ANSWERS_W),
      top: 0,
      width: Math.min(o.size.w, ASK_ANSWERS_W),
      height: o.size.h,
    };
    const far = (fit: Rect) =>
      rectGap(
        {
          left: fit.left + a.left,
          top: fit.top + a.top,
          width: a.width,
          height: a.height,
        },
        near,
      );
    const all: { t: typeof here; d: number; i: number }[] = [];
    const add = (t: typeof here) => {
      const k = `${t.fit.left},${t.fit.top}`;
      if (seen.has(k)) return;
      seen.add(k);
      all.push({ t, d: far(t.fit), i: all.length });
    };
    for (const t of tries()) add(t);
    const step = o.size.h + PILL_BAND_GAP;
    const from = onRight ? rightX : leftX;
    const dir = onRight ? -1 : 1;
    const topRow = PILL_MARGIN + o.size.h - (o.view.h - PILL_BAND_GAP);
    // rows a third of a step apart too (a clear gap between two of the page's controls is rarely
    // on the pill-height grid): each at both edges and centred; the anchor's row and those within
    // a step of it also slid from the anchor's edge in PILL_TAB.w/2 steps
    const fine = Math.max(1, Math.ceil(step / 3));
    for (let j = 0; row - j * fine >= topRow || row + j * fine <= 0; j++) {
      for (const y of j ? [row + j * fine, row - j * fine] : [row]) {
        // a row inside the window only (the pill's top under the top margin, its foot above the band)
        if (y > 0 || y < topRow) continue;
        add(at({ x: from, y }));
        add(at({ x: onRight ? leftX : rightX, y }));
        add(at({ x: midX, y }));
        if (j * fine > step) continue;
        for (let k = 1; k * (PILL_TAB.w / 2) < Math.abs(rightX - leftX); k++) {
          add(at({ x: from + dir * k * (PILL_TAB.w / 2), y }));
        }
      }
    }
    const c0 = o.controls(here.fit);
    if (c0 === 0) return { ...here, controls: 0 };
    best = here;
    n = c0;
    all.sort((p, q) => p.d - q.d || p.i - q.i);
    for (const { t } of all) {
      if (t === here) continue;
      const c = o.controls(t.fit);
      if (c < n) {
        best = t;
        n = c;
        if (c === 0) break;
      }
    }
    return { ...best, controls: n };
  }
  for (const t of tries()) {
    const k = `${t.fit.left},${t.fit.top}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const c = o.controls(t.fit);
    if (c < n) {
      best = t;
      n = c;
      if (c === 0) break;
    }
  }
  return { ...best, controls: n };
}

/** REQ-835 (cycle dm2, m2) — the translate of a computed `transform` ("none", matrix, matrix3d) */
export function translateOf(css: string): { x: number; y: number } {
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec(css.trim());
  if (!m) return { x: 0, y: 0 };
  const v = m[2].split(",").map((n) => Number(n.trim()));
  const [x, y] = m[1] ? [v[12], v[13]] : [v[4], v[5]];
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

/**
 * REQ-835 (cycle dm2, m2) — the box the customer's pill is coming to rest in: its real box (the
 * element's bounding rect, the dock translate included) less the part of the glide still to go
 * (`now`: the computed translate; `to`: the dock it glides to). The stage is sent this, never
 * atRef's left/top with a size measured later (REQ-816 moved the pill without touching atRef).
 * REQ-871 (demo-loop cycle dm5, p1) — its width and height round UP, never to the nearest: her
 * shrink-to-fit pill has a fractional width (404.25), and the stage lays the ghost's words out at
 * exactly this width with her metrics (REQ-865), so half a pixel short cut "… is guiding y…".
 */
export function pillRestBox(
  box: Rect,
  now: { x: number; y: number },
  to: { x: number; y: number },
): Rect {
  return {
    left: Math.round(box.left - now.x + to.x),
    top: Math.round(box.top - now.y + to.y),
    width: Math.ceil(box.width),
    height: Math.ceil(box.height),
  };
}

/**
 * REQ-643 (demo-loop cycle 5, p18-3d) — a fixed box that covers the view down to the band is a
 * dialog's backdrop: on a phone the mobile `.app` is transformed, so a backdrop inside it
 * (`position:fixed; inset:0`) covers only the app's box, which ends at the band's top.
 */
export function backdropCovers(r: Rect, view: Size, band: number): boolean {
  return coversView(r, { w: view.w, h: view.h - Math.max(0, band) });
}

/** REQ-643 — a see-through colour (0 < alpha < 1): a dialog's dim. A fixed box that covers the
 *  view and paints none — the phone's own `.app` shell, fixed and full height once no room is
 *  reserved — is not a backdrop */
export function seeThrough(color: string): boolean {
  const m = color.trim().match(/^rgba?\(([^)]*)\)$/);
  if (!m) return false;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 4) return false;
  const a = parts[3].endsWith("%")
    ? Number(parts[3].slice(0, -1)) / 100
    : Number(parts[3]);
  return a > 0 && a < 1;
}

/** REQ-643 — the dim the band takes under a backdrop that stops short of the window's foot (its
 *  own colour); none when it reaches the foot (it dims the band itself) or paints nothing */
export function backdropDim(
  r: Rect,
  view: Size,
  color: string,
): string | null {
  if (r.top + r.height >= view.h - 1) return null;
  const c = color.trim();
  if (!c || c === "transparent") return null;
  const a = c.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
  if (a && Number(a[1]) === 0) return null;
  return c;
}

/**
 * REQ-765 (demo-loop cycle 5v2, p18-3d) — the dim of the dialog that is up, for the stage: the
 * mirror skips the overlay, so the stage draws the band and the pill over the replayed page and
 * paints them in this dim itself (REQ-643 dimmed only the customer's own band). Only a
 * see-through colour is a dim; an opaque full-screen sheet, or none, is not.
 */
export function dialogDim(color: string): string | null {
  const c = color.trim();
  return seeThrough(c) ? c : null;
}

/** REQ-765 — the pill (and the stage's ghost of it) under a dialog's dim: softened, still there
 *  and clickable (REQ-379 keeps it above every app dialog so End stays reachable) */
export const PILL_UNDER_DIALOG_OPACITY = 0.6;

/** REQ-643 — the band's background: the page's own colour, under the dialog's dim when one is up */
export function bandPaint(bg: string, dim: string | null): string {
  return dim ? `linear-gradient(${dim}, ${dim}), ${bg}` : bg;
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
 * REQ-865 (demo-loop cycle dm4, p1) — the customer pill's box metrics: its gap, padding and font
 * size. One definition for the customer's pill (DemoModeOverlay) and the stage's ghost of it,
 * which lays its words out at these px and then scales by the frame's `s` — never its own,
 * hand-scaled numbers (they cut words the customer sees whole).
 */
export const PILL_BOX_METRICS = "gap:10px;padding:7px 12px;font-size:13px";
/** REQ-536 / REQ-865 — the customer pill's status chip ("Connected"), and the ghost's copy of it */
export const PILL_STATUS_CHIP =
  "padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11.5px;font-weight:700";

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

/**
 * REQ-835 (demo-loop cycle dm2, m2; amends REQ-822 / REQ-540) — how the stage's ghost lays its
 * words out: one row, cut with an ellipsis (the desktop pill), or — when the customer's pill wraps
 * (`pillWraps`: the phone's compact pill, opened or asking) — rows like theirs, words whole, never
 * squeezed to a sliver. `box`: the ghost's flow; `text`: its line; `part`: the guide's name.
 *
 * REQ-851 (demo-loop cycle dm3, p3; amends REQ-835) — End's question is laid out as EndDemo lays
 * it: `ask` is the GROUP that holds the question and both answers (EndDemo's
 * `[data-cy=demo-end-ask]` span), `q` the question inside it. Wrapping, the group takes a row of
 * its own and wraps inside itself (EndDemo's `ownRow`), so the answers sit beside the question
 * when they fit — the customer's 2 rows, never a third row of answers under the question.
 */
export function ghostFlow(
  wraps: boolean,
): { box: string; text: string; part: string; ask: string; q: string } {
  return wraps
    ? {
      box: "flex-wrap:wrap;align-content:center;white-space:normal",
      text: "flex:0 1 auto;overflow:hidden",
      part: "flex:0 1 auto;overflow:hidden",
      // the group (question + answers) takes the row and wraps inside it: EndDemo's `ownRow`
      ask:
        "display:inline-flex;align-items:center;flex-wrap:wrap;flex:0 1 100%;min-width:0",
      q: "flex:0 1 auto;overflow:hidden",
    }
    : {
      box: "flex-wrap:nowrap;white-space:nowrap",
      text: "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis",
      part: "flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis",
      ask:
        "display:inline-flex;align-items:center;flex-wrap:nowrap;flex:0 1 auto;min-width:0",
      q: "flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis",
    };
}

/** REQ-372 — the customer's pill runs off their screen (it would be cut, or the stage's copy is) */
export function pillOverflows(r: Rect, view: Size, tolerance = 1): boolean {
  return r.left < -tolerance || r.top < -tolerance ||
    r.left + r.width > view.w + tolerance ||
    r.top + r.height > view.h + tolerance;
}

/** REQ-372 — the pill's status as the stage words it (the presenter's dictionary). REQ-838 —
 *  "away" (the customer's link is up, no stage is): a word that names nobody */
export function statusKeyOf(s: PillStatus): string {
  return s === "live"
    ? "demoMode.connected"
    : s === "ended"
    ? "demoMode.ended"
    : s === "away"
    ? "demoMode.away"
    : "demoMode.connecting";
}

/** REQ-838 (demo-loop cycle dm2, m5 + p4) — the customer's own word for status `s`: the label
 *  their pill sent while in `s`, else the word it carries for it (connectingLabel, endedLabel);
 *  none from a page that carries none — then the stage words it (ghostWords) */
function ownWord(face: PillFace, s: PillStatus): string | undefined {
  if (face.status === s && face.label) return face.label;
  return s === "connecting"
    ? face.connectingLabel
    : s === "ended"
    ? face.endedLabel
    : undefined;
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
 *
 * REQ-822 (demo-loop cycle dm1, m1) — End asking on the customer's pill: its question and both
 * answers in End's place (the stage draws the answers as disabled chips), in the customer's words
 * when their pill sent them, else the stage's ("Wants to end the demo", Yes, end it / Keep going).
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
  ask?: string;
  yes?: string;
  no?: string;
  /** REQ-895 — the notice's × (the pill is the ended notice: no status chip, no End) */
  dismiss?: string;
} {
  const closed = face.compact === true && face.open !== true;
  const heard = face.status !== undefined;
  // REQ-895 (demo-loop run 6, m6) — the ended notice: its words are the title, the text and a ×;
  // its label drawn as a status chip squeezed the text to "Ter…" on the stage's last frame
  const notice = heard && face.notice === true;
  const asking = heard && face.status !== "ended" && face.asking === true;
  // REQ-875 (dm5, p4) — held between pages: no status word (the stage's chrome says "Loading
  // their next page…"); an ended demo still says so
  const quiet = face.held === true && face.status !== "ended";
  const status = heard && !quiet && !notice
    ? face.label || t(statusKeyOf(face.status!))
    : undefined;
  return {
    title: heard && face.compact !== true
      ? face.title || t("demoMode.title")
      : undefined,
    // REQ-895 — the compact (phone) notice still shows its text, never a guide's short name
    text: (!closed || notice) && face.text ? face.text : undefined,
    guide: closed && !notice && face.guide ? face.guide : undefined,
    status,
    end: heard && face.status !== "ended" && !asking
      ? face.end || t("demoMode.end")
      : undefined,
    ask: asking ? face.ask || t("demoMode.pillGhostAsking") : undefined,
    yes: asking ? face.yes || t("demoMode.endYes") : undefined,
    no: asking ? face.no || t("demoMode.endNo") : undefined,
    dismiss: notice ? "×" : undefined,
  };
}

/** REQ-822 — the face fields that only the customer's overlay changes (End's question and how
 *  wide it makes the pill): nothing in the mirrored page goes with them */
const OVERLAY_ONLY = new Set([
  "asking",
  "ask",
  "yes",
  "no",
  "clipped",
  // REQ-835 (dm2, m2) — the question wraps the phone's pill: it comes and goes with it
  "wraps",
]);
/** REQ-822 — and the fields the stage's own guess sets after a follow switch (pillFaceAwaiting) */
const GUESSED = new Set(["status", "label", "tucked"]);

/** REQ-822 — the two faces differ only in `fields` (undefined and absent are alike) */
function differsOnlyIn(a: PillFace, b: PillFace, fields: Set<string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (fields.has(k)) continue;
    const x = (a as Record<string, unknown>)[k];
    const y = (b as Record<string, unknown>)[k];
    if (x !== y) return false;
  }
  return true;
}

/**
 * REQ-822 (demo-loop cycle dm1, m1) — a pill face the stage shows at once instead of holding it
 * for its frame (REQ-636): one whose only change from the face on the stage (`shown`) is End's
 * question going up or down — the customer's own tap, no page change goes with it — or, right
 * after a follow switch (`awaiting`: the stage shows its own guess, pillFaceAwaiting), the new
 * page's first face when it differs from that guess only in what the guess made up (status,
 * label, tucked): the folded mini-pill replaces the guessed whole pill at once. REQ-828 (dm2,
 * p7) — and, when the shown face was itself shown at once with no frame since (`quick`), a face
 * whose only change is the tuck (folding changes nothing on the mirrored page). A tuck, an
 * opened pill or new words otherwise still wait for their frame.
 */
export function pillShowsAtOnce(
  shown: PillFace,
  next: PillFace,
  awaiting: boolean,
  quick = false,
): boolean {
  // REQ-895 (dm6, m6) — the pill turned into the ended notice: the overlay's own state (the page
  // under it did not change, so no frame follows it to release it — it waited PILL_HOLD_MAX_MS)
  if (next.notice === true && shown.notice !== true) return true;
  const fields = new Set(OVERLAY_ONLY);
  if (awaiting) { for (const k of GUESSED) fields.add(k); }
  // REQ-828 (dm2, p7) — the shown face came at once and no frame since (PillSync.atOnce): the
  // pill folding back to its tab (Keep going, then the peek ends) is the same overlay gesture
  const tucked = quick && (shown.tucked === true) !== (next.tucked === true);
  if (tucked) fields.add("tucked");
  const asked = (shown.asking === true) !== (next.asking === true);
  return (asked || awaiting || tucked) && differsOnlyIn(shown, next, fields);
}

/**
 * REQ-540 (demo-loop cycle 4, m9) — a new page of the customer joined (onPeerOnline): its pill
 * is still connecting and cannot say so (its face rides the very link that is opening), so the
 * stage's ghost keeps the last pill and says "Connecting…" in the stage's words until the new
 * page's pill speaks — never a blank, never a stale "Connected". An ended demo stays ended.
 * REQ-636 — and untucked (the old page's tuck is not the new page's).
 * REQ-854 (demo-loop cycle dm3, p6) — REQ-636 AMENDMENT: the old page's fold IS kept (with its
 * band): since REQ-830 a new page's first frame folds as the last page did, so an untucked guess
 * drew the whole pill's words in the tab's box, a state the customer never shows. The new page's
 * own face still replaces the guess at once (GUESSED includes `tucked`).
 * REQ-838 (demo-loop cycle dm2, m5) — "Connecting…" (or ended) in the CUSTOMER's words when their
 * pill carries them: never the presenter's word beside their title, line and End.
 */
export function pillFaceAwaiting(face: PillFace): PillFace {
  // REQ-854 (dm3, p6) — the tuck stays (REQ-830: the new page starts folded as the old one was);
  // the new page's own face decides it at once (pillShowsAtOnce, GUESSED)
  // REQ-822 (dm1, m1) — nor is it asking: End's question was the old page's pill's
  const {
    label: _label,
    asking: _asking,
    ask: _ask,
    yes: _yes,
    no: _no,
    // REQ-875 (dm5, p4) — a page joined: the hold is over, it is connecting
    held: _held,
    ...rest
  } = face;
  const status = face.status === "ended" ? "ended" : "connecting";
  const label = ownWord(face, status);
  return { ...rest, status, ...(label ? { label } : {}) };
}

/**
 * REQ-854 (demo-loop cycle dm3, p6) — the stage's ghost of the customer's pill is drawn as the
 * folded tab ("● Demo ×"), not the whole pill: when the face is tucked, or — a guard — while the
 * stage awaits a new page of theirs (its face is the stage's own guess) and the box it holds is
 * still the tab's. The whole pill's words never go in a tab-sized box.
 */
export function ghostDrawsTab(
  face: PillFace,
  box: { width: number; height: number } | null,
  awaiting: boolean,
): boolean {
  if (face.tucked === true) return true;
  if (!awaiting || !box) return false;
  return box.width <= PILL_TAB.w + 1 && box.height <= PILL_TAB.h + 1;
}

/**
 * REQ-430 — the customer's app dropped (the stage's link is waiting, between tabs or over): the
 * frozen ghost must not keep saying the last "Connected". Its status becomes connecting (ended
 * when the demo ended) and the customer's own label goes — the stage words it until their pill
 * speaks again. No pill heard yet: nothing changes.
 *
 * REQ-646 (demo-loop cycle 5, m63) — `replaced` is not a drop: the customer is still there, it
 * is THIS window that stopped hearing them (another window of the account has the demo). The
 * face is kept as it was — never "Connecting…" — and the stage hides the ghost while elsewhere.
 *
 * REQ-838 (demo-loop cycle dm2, m5 + p4) — the new status is said in the CUSTOMER's words when
 * their pill carries them (connectingLabel, endedLabel; a face already in it keeps its own): the
 * stage's dictionary only for a page that sent none.
 */
export function pillFaceOffline(face: PillFace, link: string): PillFace {
  if (!face.status || link === "replaced") return face;
  // REQ-875 (demo-loop cycle dm5, p4) — "between" is not a drop: her page went and the link
  // holds it (SILENT_GRACE_MS, a navigation) while the chrome says "Loading their next page…".
  // Nothing is connecting, so the ghost keeps her last face, marked held: no status word (never
  // "Connecting…", nor a stale "Connected"). An ended demo stays ended.
  if (link === "between") {
    return face.status === "ended" ? face : { ...face, held: true };
  }
  const { label: _label, held: _held, ...rest } = face;
  const status = link === "ended" ? "ended" : "connecting";
  const label = ownWord(face, status);
  return { ...rest, status, ...(label ? { label } : {}) };
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
