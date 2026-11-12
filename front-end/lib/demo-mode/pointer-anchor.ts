/**
 * REQ-371 (demo m10, cycle 2) — where the customer's pointer and clicks are anchored, and how
 * long a touch stays drawn.
 *
 *   - `anchorAt`: the anchor of a point of the customer's screen, taken from the hit-test STACK
 *     (`document.elementsFromPoint`) with the demo's own chrome (`[data-demo-overlay]`, never
 *     mirrored) skipped — the pill over a row never makes the anchor fall back to an ancestor's
 *     box, which put the stage's click wave one row off;
 *   - `placeWavesAgain`: the stage's click waves keep their anchor and are placed again on every
 *     layout pass of the replay, like the pointer;
 *   - `createTouchFade`: a touch pointer has no pointerleave, so a last tap stayed drawn on the
 *     stage like a hover; TOUCH_REST_MS after the last touch the pointer is let go.
 */
import {
  type Anchor,
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

/** the stage's click waves placed again from their anchors; the same array when none moved */
export function placeWavesAgain<
  W extends { x: number; y: number; a: Anchor },
>(waves: W[], place: (a: Anchor) => { x: number; y: number }): W[] {
  let moved = false;
  const out = waves.map((w) => {
    const at = place(w.a);
    if (at.x === w.x && at.y === w.y) return w;
    moved = true;
    return { ...w, x: at.x, y: at.y };
  });
  return moved ? out : waves;
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
