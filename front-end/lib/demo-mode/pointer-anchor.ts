/**
 * REQ-371 (demo m10, cycle 2) — where the customer's pointer and clicks are anchored, and how
 * long a touch stays drawn.
 *
 *   - `anchorAt`: the anchor of a point of the customer's screen, taken from the hit-test STACK
 *     (`document.elementsFromPoint`) with the demo's own chrome (`[data-demo-overlay]`, never
 *     mirrored) skipped — the pill over a row never makes the anchor fall back to an ancestor's
 *     box, which put the stage's click wave one row off;
 *   - `newStageWave` / `placeWavesAgain` (REQ-546, demo m14, cycle 4): a stage click wave is
 *     frozen where it was placed and dropped when its node goes, re-lays out, or the page load
 *     changes — never moved to the click's fraction (that is another button on a swapped card);
 *   - `createTouchFade`: a touch pointer has no pointerleave, so a last tap stayed drawn on the
 *     stage like a hover; TOUCH_REST_MS after the last touch the pointer is let go.
 */
import {
  type Anchor,
  fracToPoint,
  pointToFrac,
  type Rect,
} from "../../../shared/demo-mode/protocol.ts";

/** how long a touch pointer stays drawn after the last touch */
export const TOUCH_REST_MS = 3_000;

/** the bits of a node the anchoring reads (a DOM element, or a test double) */
interface HitNode {
  parentNode: unknown;
  nodeType: number;
  hasAttribute?(name: string): boolean;
}

/** the recorder's half the anchoring needs (mirror-record.ts) */
export interface AnchorRecorder<E> {
  idOf(n: E | null): number | null;
  nodeOf(id: number): { getBoundingClientRect(): Rect } | null;
}

/** is this node the demo's own chrome, or inside it */
export function inOverlay(n: HitNode | null): boolean {
  for (let a = n; a; a = a.parentNode as HitNode | null) {
    if (a.nodeType === 1 && a.hasAttribute?.("data-demo-overlay")) return true;
  }
  return false;
}

/** the topmost element of a hit-test stack that belongs to the page, not to the demo's chrome */
export function pageTopAt<E extends HitNode>(stack: readonly E[]): E | null {
  return stack.find((el) => !inOverlay(el)) ?? null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** a point of the customer's screen for the presenters: the fraction of the viewport and, when
 *  the page has one there, the mirrored element under it and where in its box */
export function anchorAt<E extends HitNode>(
  p: { x: number; y: number },
  view: Rect,
  stack: readonly E[],
  recorder: AnchorRecorder<E> | null,
  load: string | null,
): Anchor {
  const a = pointToFrac(p, view);
  if (!recorder || load === null) return a;
  const top = pageTopAt(stack);
  if (!top) return a;
  const id = recorder.idOf(top);
  const el = id === null ? null : recorder.nodeOf(id);
  if (id === null || !el) return a;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return a;
  return {
    ...a,
    n: {
      id,
      x: clamp01((p.x - r.left) / r.width),
      y: clamp01((p.y - r.top) / r.height),
      l: load,
    },
  };
}

/** REQ-546 (demo m14, cycle 4) — how far (stage px) a wave's node may move before the wave is
 *  dropped: further, and the node re-laid out (its card collapsed, a scroll) — the click did not
 *  happen where the node is now */
export const WAVE_DRIFT_PX = 12;

/** REQ-546 — the stage's frame as a wave sees it: the fitted box, the replay's page load, and
 *  where an anchor's node is drawn on the stage (null: no node, another load, or gone) */
export interface WaveFrame {
  box: Rect;
  load: string | null;
  nodeAt(a: Anchor): { x: number; y: number } | null;
}

/** REQ-546 — a click wave on the stage, frozen where it was placed */
export interface StageWave {
  id: number;
  /** where it is drawn on the stage */
  x: number;
  y: number;
  /** the click's anchor */
  a: Anchor;
  /** where it is in the frame (0..1 of the fitted box): it follows a refit, nothing else */
  u: number;
  v: number;
  /** placed on its node (else at the click's fraction, the node not there yet) */
  on: boolean;
  /** the replay's page load it is drawn on */
  l: string | null;
}

const inBox = (p: { x: number; y: number }, box: Rect) => ({
  u: box.width > 0 ? (p.x - box.left) / box.width : 0,
  v: box.height > 0 ? (p.y - box.top) / box.height : 0,
});
const atBox = (w: { u: number; v: number }, box: Rect) => ({
  x: box.left + box.width * w.u,
  y: box.top + box.height * w.v,
});

/** REQ-546 (demo m14, cycle 4) — a click wave placed once, where the click happened: on its node
 *  when the replay has it, else at the click's fraction of the frame (the frame lags the click) */
export function newStageWave(id: number, a: Anchor, f: WaveFrame): StageWave {
  const p = f.nodeAt(a);
  const at = p ?? fracToPoint(a, f.box);
  return { id, x: at.x, y: at.y, a, ...inBox(at, f.box), on: !!p, l: f.load };
}

/** REQ-371 → REQ-546 (demo m14, cycle 4) — the stage's click waves after a layout pass. A wave
 *  stays where it was placed (it follows only a refit of the frame), and goes when what was
 *  clicked is no longer there: its node gone (a card swapped in place), moved past
 *  WAVE_DRIFT_PX (re-laid out), or the replay on another page load. It never falls back to the
 *  click's fraction — on the new card that is another button. A wave placed at the fraction for
 *  want of its node moves onto the node once the replay has it (its load, too, when that lagged).
 *  The same array when none moved or went. */
export function placeWavesAgain(waves: StageWave[], f: WaveFrame): StageWave[] {
  let changed = false;
  const out: StageWave[] = [];
  for (const w of waves) {
    const next = placeWave(w, f);
    if (next !== w) changed = true;
    if (next) out.push(next);
  }
  return changed ? out : waves;
}

function placeWave(w: StageWave, f: WaveFrame): StageWave | null {
  let l = w.l;
  if (f.load !== l) {
    // the replay caught up with the page the click was made on: look its node up there
    if (w.on || !w.a.n?.l || w.a.n.l !== f.load) return null;
    l = f.load;
  }
  const p = f.nodeAt(w.a);
  if (w.on && !p) return null;
  const frozen = atBox(w, f.box);
  if (p && w.on) {
    if (Math.hypot(p.x - frozen.x, p.y - frozen.y) > WAVE_DRIFT_PX) return null;
  }
  if (p && !w.on) {
    return { ...w, x: p.x, y: p.y, ...inBox(p, f.box), on: true, l };
  }
  if (frozen.x === w.x && frozen.y === w.y && l === w.l) return w;
  return { ...w, ...frozen, l };
}

/** fades a touch pointer `ms` after its last touch; a mouse or pen pointer is never faded */
export function createTouchFade(o: { ms: number; fade: () => void }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    seen(pointerType: string) {
      cancel();
      if (pointerType !== "touch") return;
      timer = setTimeout(() => {
        timer = undefined;
        o.fade();
      }, o.ms);
    },
    cancel,
  };
}
