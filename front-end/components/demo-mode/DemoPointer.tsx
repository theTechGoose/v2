/**
 * REQ-153 — the other side's pointer (an arrow with their name) and the waves where they clicked,
 * above everything with pointer events off. Drawn by the customer's overlay and the staff's stage.
 *
 * REQ-242 — the name tag stays inside `bounds` (the stage's frame, or the customer's window).
 *
 * REQ-374 (demo m9/p8, cycle 2) — the tag sits above-left of the tip, off the content pointed at,
 * and flips right or down only at an edge (`tagPlacement`); at rest (TAG_IDLE_MS) it fades to
 * TAG_REST_OPACITY, never out, and any re-placement shows it fully again. The arrow is always
 * fully opaque, with a dark outline over a white halo so it reads on light and dark content.
 *
 * REQ-305 — `outside`: the element pointed at is out of view, the arrow sits on the edge of
 * `bounds` pointing at it (`data-outside`, marked by a dashed ring) — never off-screen.
 *
 * REQ-437 (demo m3 + p8-pair3-a, cycle 3) — the tag sits OUTSIDE `rect` (the element the pointer
 * is anchored to), past its edge with the most room, else below-right past the arrow's tail
 * (`tagPlacement`), clamped inside `bounds`. It is placed on every painted frame from the DRAWN
 * arrow (the glide's painter, `attach`'s second argument) with the tag's measured size, the side
 * on `data-tag-side` — never from the glide's target with a guessed width.
 *
 * REQ-543 (demo m6, cycle 4) — the tag sits NEXT to the arrow (within TAG_REACH = 40 px of the
 * tip, the nearest free side, not the roomiest), off the other controls of the page under it
 * (`coversControl`), TAG_EDGE px inside `bounds`.
 *
 * REQ-451 (demo M14, cycle 3) — `off`: the sender's pointer is OFF the shared screen (a
 * presenter's mouse beside the phone frame on his stage, `o: 1`). Not the arrow and the name over
 * the screen's controls: a small translucent marker against the edge it is off, pointing that way
 * (`offMark`), no tag, no ring (`data-off`).
 *
 * REQ-635 (demo m37, cycle 5) — the bare chevron read as a stray '<' on every page of the
 * customer's phone: the marker now carries the sender's initial on a dot in their colour
 * (`offBadge`, `initialOf`), fades out after OFF_MARK_SHOW_MS (a new spot shows it again: it is
 * keyed on the rounded point), and with `offZ` (the customer's overlay: OFF_MARK_Z) its layer
 * sits under the app's modal dims while off.
 *
 * REQ-546 (demo m14, cycle 4) — the waves and the last-click dot are drawn inside a clip with
 * `bounds`' box (`data-cy="demo-wave-clip"`, overflow:hidden), never over what is around it.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import {
  pointerLook,
  type Pt,
  type Rect,
  TAG_IDLE_MS,
  tagPlacement,
} from "../../../shared/demo-mode/motion.ts";
import {
  initialOf,
  OFF_BADGE_PX,
  OFF_MARK_FADE_MS,
  OFF_MARK_OPACITY,
  OFF_MARK_PX,
  OFF_MARK_SHOW_MS,
  offBadge,
  offMark,
} from "../../../shared/demo-mode/presenter-anchor.ts";

export interface Wave {
  id: number;
  x: number;
  y: number;
}
/** REQ-431 (demo m28, cycle 3) — one ring lasted 1.1 s and was missed by eye: the ring repeats
 *  WAVE_RINGS times (about 2.85 s in all), and the LAST click leaves a small dot that fades over
 *  CLICK_DOT_MS. Drawn at the wave's x/y, the dot is re-placed with it (`placeWavesAgain`). */
export const WAVE_RING_MS = 950;
export const WAVE_RINGS = 3;
export const CLICK_DOT_MS = 4000;
/** REQ-546 (demo m14, cycle 4) — the ring's size: 180 px enclosed the neighbouring chips */
export const WAVE_PX = 120;
/** how long a wave stays in state: until its ring and its dot are both done */
export const WAVE_MS = Math.max(WAVE_RING_MS * WAVE_RINGS, CLICK_DOT_MS);

/** the arrow, its tip at (2, 2) of a 22 × 28 box drawn at 24 × 30 */
export const ARROW_PATH =
  "M2 2 L2 22 L7.5 17 L11 26 L14.5 24.5 L11 16 L18 16 Z";
export const ARROW_W = 24;
export const ARROW_H = 30;
/** REQ-451 — the off-screen marker: a chevron pointing right, turned to the edge it is off */
const OFF_MARK_PATH = "M4.5 2.5 L10 7 L4.5 11.5";

export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** the window, when the caller names no box */
const windowBox = (): Bounds => ({
  left: 0,
  top: 0,
  width: globalThis.innerWidth || 0,
  height: globalThis.innerHeight || 0,
});

/** REQ-437 — the tag's size before it is laid out (SSR, the first paint): 12px bold, padded */
const estimate = (name: string) => ({ w: 18 + name.length * 7.5, h: 22 });

/** REQ-543 (demo m6, cycle 4) — what counts as a control the tag must not sit on */
export const CONTROL_SELECTOR =
  "button,a[href],input,select,textarea,summary,label,[role=button],[role=link],[role=option],[role=tab],[role=radio],[role=checkbox],[role=menuitem]";

/** REQ-543 — the topmost control at (x, y) of `doc` other than the one `tip` is on (the target,
 *  or a control holding it), looking through a same-origin iframe (the stage's mirror of the
 *  customer's page, scaled into its frame) */
function otherControlAt(
  doc: Document,
  x: number,
  y: number,
  tip: Pt,
  depth = 0,
): boolean {
  const el = typeof doc.elementFromPoint === "function"
    ? doc.elementFromPoint(x, y)
    : null;
  if (!el) return false;
  if (el.tagName === "IFRAME" && depth < 2) {
    const f = el as HTMLIFrameElement;
    let inner: Document | null = null;
    try {
      inner = f.contentDocument;
    } catch {
      inner = null;
    }
    if (!inner) return false;
    const b = f.getBoundingClientRect();
    const s = f.clientWidth ? b.width / f.clientWidth : 1;
    const map = (p: Pt): Pt => ({
      x: (p.x - b.left) / s - f.clientLeft,
      y: (p.y - b.top) / s - f.clientTop,
    });
    const at = map({ x, y });
    return otherControlAt(inner, at.x, at.y, map(tip), depth + 1);
  }
  const c = el.closest(CONTROL_SELECTOR);
  if (!c) return false;
  const r = c.getBoundingClientRect();
  return !(tip.x >= r.left && tip.x <= r.left + r.width &&
    tip.y >= r.top && tip.y <= r.top + r.height);
}

/** REQ-543 (demo m6) — would a tag drawn at `r` cover a control other than the one the arrow at
 *  `tip` points at ('Carl' over Cancel)? Hit-tests its centre and inset corners on the page */
export function coversControl(doc: Document, r: Rect, tip: Pt): boolean {
  const i = 2;
  const xs = [r.left + i, r.left + r.width / 2, r.left + r.width - i];
  const ys = [r.top + i, r.top + r.height / 2, r.top + r.height - i];
  const pts: Pt[] = [
    { x: xs[1], y: ys[1] },
    { x: xs[0], y: ys[0] },
    { x: xs[2], y: ys[0] },
    { x: xs[0], y: ys[2] },
    { x: xs[2], y: ys[2] },
  ];
  return pts.some((p) => otherControlAt(doc, p.x, p.y, tip));
}

/** REQ-437 + REQ-543 — place the tag element for an arrow drawn at `tip`: its MEASURED size (the
 *  estimate only while it has none), outside `rect`, next to the arrow, off the controls `covers`
 *  finds, inside `box`; left/top relative to the tip (the pointer box is translated to it) and
 *  the side on `data-tag-side` */
export function placeTag(
  el: HTMLElement,
  tip: Pt,
  box: Bounds,
  rect: Rect | null,
  fallback: { w: number; h: number },
  covers?: (r: Rect) => boolean,
): void {
  const tag = {
    w: el.offsetWidth || fallback.w,
    h: el.offsetHeight || fallback.h,
  };
  const at = tagPlacement(tip, box, tag, rect, covers);
  el.style.left = `${at.x - tip.x}px`;
  el.style.top = `${at.y - tip.y}px`;
  el.setAttribute("data-tag-side", at.side);
}

export default function DemoPointer(
  {
    pointer,
    outside,
    off,
    offZ,
    rect,
    waves,
    name,
    color,
    z,
    attach,
    bounds,
  }: {
    pointer: Pt | null;
    outside?: boolean;
    /** REQ-451 — the sender's pointer is off the shared screen: the small edge marker */
    off?: boolean;
    /** REQ-635 — the layer while off (the customer's overlay: under the app's modal dims) */
    offZ?: number;
    /** REQ-437 — the box of the element the pointer is anchored to (null: none, or out of view) */
    rect?: Rect | null;
    waves: Wave[];
    name: string;
    color: string;
    z: number;
    /** the glide's ref callback; `onPaint` gets every DRAWN position of the arrow */
    attach(el: HTMLDivElement | null, onPaint?: (p: Pt) => void): void;
    bounds?: Bounds;
  },
) {
  /** the tag rests (fades, never out) a while after the pointer was last placed */
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!pointer) return;
    setIdle(false);
    const tag = setTimeout(() => setIdle(true), TAG_IDLE_MS);
    return () => clearTimeout(tag);
    // REQ-374 — every placement is a new object (a move, a re-anchor after a scroll, an edge
    // toggle), so the tag comes back fully on any of them, not only on a new x/y
  }, [pointer, outside]);
  const look = pointerLook(idle);

  /** what the painter places the tag in, as of the latest render */
  const live = useRef<
    { bounds?: Bounds; rect: Rect | null; fallback: { w: number; h: number } }
  >({ rect: null, fallback: estimate(name) });
  const tagRef = useRef<HTMLSpanElement | null>(null);
  const drawn = useRef<Pt | null>(null);
  const paintTag = useCallback((p: Pt) => {
    drawn.current = p;
    const el = tagRef.current;
    if (!el) return;
    const l = live.current;
    // REQ-543 — off the other controls of the page under it (the tag and arrow are
    // pointer-events:none, so the hit-test sees through them)
    const doc = globalThis.document;
    placeTag(
      el,
      p,
      l.bounds ?? windowBox(),
      l.rect,
      l.fallback,
      doc && l.rect ? (r) => coversControl(doc, r, p) : undefined,
    );
  }, []);
  const ref = useCallback(
    (el: HTMLDivElement | null) => attach(el, el ? paintTag : undefined),
    [attach],
  );
  // a re-render rewrites the tag's style (opacity, a new target): place it again from the drawn
  // arrow, with its measured size
  useLayoutEffect(() => {
    if (drawn.current) paintTag(drawn.current);
  });
  // REQ-437 — the first render places the tag from the target with the estimated size; every
  // painted frame then places it from the drawn arrow with the measured one
  const fallback = estimate(name);
  live.current = { bounds, rect: outside ? null : rect ?? null, fallback };
  const place = pointer
    ? tagPlacement(
      pointer,
      bounds ?? windowBox(),
      fallback,
      outside ? null : rect,
    )
    : null;
  const mark = pointer && off ? offMark(pointer, bounds ?? windowBox()) : null;
  const badge = pointer && off
    ? offBadge(pointer, bounds ?? windowBox())
    : null;
  /** REQ-635 — shown for OFF_MARK_SHOW_MS, then faded out over OFF_MARK_FADE_MS */
  const showFor = OFF_MARK_SHOW_MS / (OFF_MARK_SHOW_MS + OFF_MARK_FADE_MS);
  /** a new spot remounts the marker (its fade starts again); the same spot re-sent does not */
  const markKey = pointer
    ? `${Math.round(pointer.x)},${Math.round(pointer.y)}`
    : "";
  const clip = bounds ?? windowBox();
  return (
    <>
      <style>
        {`@keyframes pmDemoWave{0%{transform:translate(-50%,-50%) scale(.15);opacity:.95}100%{transform:translate(-50%,-50%) scale(1);opacity:0}}@keyframes pmDemoClickDot{0%{opacity:.95}60%{opacity:.8}100%{opacity:0}}@keyframes pmDemoOffFade{0%{opacity:${OFF_MARK_OPACITY}}${
          Math.round(showFor * 100)
        }%{opacity:${OFF_MARK_OPACITY}}100%{opacity:0}}`}
      </style>
      {waves.length > 0 && (
        // REQ-546 (demo m14, cycle 4) — the waves are clipped to `bounds` (the stage's fitted
        // frame): a fixed ring is not clipped by the stage's overflow, and one near the frame's
        // top was drawn over the impersonation banner
        <div
          data-cy="demo-wave-clip"
          style={`position:fixed;left:${clip.left}px;top:${clip.top}px;width:${clip.width}px;height:${clip.height}px;overflow:hidden;pointer-events:none;z-index:${z}`}
        >
          {waves.map((w) => (
            <span
              key={w.id}
              data-cy="demo-wave"
              style={`position:absolute;left:${w.x - clip.left}px;top:${
                w.y - clip.top
              }px;width:${WAVE_PX}px;height:${WAVE_PX}px;border-radius:50%;border:4px solid ${color};box-shadow:0 0 0 5px rgba(255,255,255,.7), 0 0 24px ${color};pointer-events:none;opacity:0;animation:pmDemoWave ${WAVE_RING_MS}ms ease-out ${WAVE_RINGS} forwards`}
            />
          ))}
          {(() => {
            // REQ-431 — the last click only: a small dot that marks "clicked here" a while longer
            const w = waves[waves.length - 1];
            return (
              <span
                key={`dot-${w.id}`}
                data-cy="demo-click-dot"
                style={`position:absolute;left:${w.x - clip.left}px;top:${
                  w.y - clip.top
                }px;width:16px;height:16px;transform:translate(-50%,-50%);border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35), 0 0 8px ${color};pointer-events:none;opacity:0;animation:pmDemoClickDot ${CLICK_DOT_MS}ms ease-in forwards`}
              />
            );
          })()}
        </div>
      )}
      {pointer && (
        <div
          data-cy="demo-pointer"
          data-presenter={name}
          data-idle={idle ? 1 : 0}
          data-outside={outside ? "" : undefined}
          data-off={off ? "" : undefined}
          ref={ref}
          style={`position:fixed;left:0;top:0;width:24px;height:30px;overflow:visible;pointer-events:none;z-index:${
            off && offZ !== undefined ? offZ : z + 1
          }`}
        >
          {off && mark && badge
            ? (
              <span
                key={markKey}
                data-cy="demo-pointer-off-mark"
                aria-hidden="true"
                style={`position:absolute;left:${mark.left}px;top:${mark.top}px;width:${OFF_MARK_PX}px;height:${OFF_MARK_PX}px;opacity:0;animation:pmDemoOffFade ${
                  OFF_MARK_SHOW_MS + OFF_MARK_FADE_MS
                }ms linear forwards`}
              >
                <svg
                  width={OFF_MARK_PX}
                  height={OFF_MARK_PX}
                  viewBox="0 0 14 14"
                  style={`position:absolute;left:0;top:0;overflow:visible;transform:rotate(${mark.deg}deg);filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))`}
                >
                  <path
                    d={OFF_MARK_PATH}
                    fill="none"
                    stroke="#fff"
                    stroke-width="5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d={OFF_MARK_PATH}
                    fill="none"
                    stroke={color}
                    stroke-width="2.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span
                  data-cy="demo-pointer-off-initial"
                  style={`position:absolute;left:${badge.left}px;top:${badge.top}px;width:${OFF_BADGE_PX}px;height:${OFF_BADGE_PX}px;border-radius:50%;background:${color};color:#fff;border:1.5px solid #fff;box-sizing:border-box;box-shadow:0 1px 2px rgba(0,0,0,.35);font:700 9px/13px system-ui,sans-serif;text-align:center;white-space:nowrap`}
                >
                  {initialOf(name)}
                </span>
              </span>
            )
            : (
              <>
                {outside && (
                  <span
                    aria-hidden="true"
                    style={`position:absolute;left:-8px;top:-8px;width:36px;height:36px;border-radius:50%;border:2px dashed ${color};opacity:.7`}
                  />
                )}
                <svg
                  width="24"
                  height="30"
                  viewBox="0 0 22 28"
                  aria-hidden="true"
                  style={`position:absolute;left:0;top:0;overflow:visible;opacity:${look.arrow};filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))`}
                >
                  <path
                    d={ARROW_PATH}
                    fill="none"
                    stroke="#fff"
                    stroke-width="4"
                    stroke-linejoin="round"
                  />
                  <path
                    d={ARROW_PATH}
                    fill={color}
                    stroke="#1a1a1a"
                    stroke-width="1.3"
                    stroke-linejoin="round"
                  />
                </svg>
                <span
                  ref={tagRef}
                  data-cy="demo-pointer-tag"
                  data-tag-side={place?.side}
                  aria-hidden="true"
                  style={`position:absolute;left:${
                    (place?.x ?? 0) - pointer.x
                  }px;top:${
                    (place?.y ?? 0) - pointer.y
                  }px;padding:2px 8px;border-radius:999px;background:${color};color:#fff;font-size:12px;font-weight:700;white-space:nowrap;border:1px solid rgba(255,255,255,.85);box-shadow:0 1px 4px rgba(0,0,0,.35);opacity:${look.tag};transition:opacity .3s`}
                >
                  {name}
                </span>
              </>
            )}
        </div>
      )}
    </>
  );
}
