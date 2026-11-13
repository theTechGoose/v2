/**
 * REQ-180 — the other side's pointer glides: the latest TARGET is state (so the pointer element
 * exists), the drawn position lives in a ref and is written to the element every frame until it
 * settles. Shared by the customer's overlay and the staff's stage.
 *
 * REQ-437 (demo m3 + p8-pair3-a, cycle 3) — every drawn position also goes to the pointer's
 * painter (`attach`'s `onPaint`), which places the name tag from where the arrow IS, not from the
 * target; `rect` is the box of the element the target is anchored to, carried with it.
 */
import { useRef, useState } from "preact/hooks";
import {
  glideStep,
  type Pt,
  type Rect,
} from "../../../shared/demo-mode/motion.ts";

export interface Glide {
  pointer: Pt | null;
  /** REQ-305 — the target sits on the edge of its box, pointing at something outside it */
  outside: boolean;
  /** REQ-437 — the box of the element the target is anchored to (null: none, or out of view) */
  rect: Rect | null;
  /** REQ-305 — the same target again (a pointer placed afresh after a layout change) is no move */
  glideTo(target: Pt, outside?: boolean, rect?: Rect | null): void;
  hide(): void;
  /** the pointer element's ref callback: paints the shown position on mount; REQ-437 —
   *  `onPaint` is called with every drawn position (the tag is placed from it) */
  attach(el: HTMLDivElement | null, onPaint?: (p: Pt) => void): void;
}

export function useGlide(): Glide {
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [outside, setOutside] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const shownRef = useRef<Pt | null>(null);
  const targetRef = useRef<Pt | null>(null);
  const outsideRef = useRef(false);
  const elRef = useRef<HTMLDivElement | null>(null);
  const onPaintRef = useRef<((p: Pt) => void) | null>(null);
  const raf = useRef(0);
  const lastFrame = useRef(0);
  const paint = (p: Pt) => {
    const el = elRef.current;
    if (el) el.style.transform = `translate(${p.x}px,${p.y}px)`;
    // REQ-437 — the tag follows the DRAWN arrow, frame by frame
    if (el) onPaintRef.current?.(p);
  };
  const frame = (now: number) => {
    raf.current = 0;
    const shown = shownRef.current;
    const target = targetRef.current;
    if (!shown || !target) return;
    const dt = now - lastFrame.current;
    lastFrame.current = now;
    const s = glideStep(shown, target, dt);
    shownRef.current = s.at;
    paint(s.at);
    if (!s.settled) raf.current = requestAnimationFrame(frame);
  };
  return {
    pointer,
    outside,
    rect,
    glideTo(target, out = false, box = null) {
      const cur = targetRef.current;
      if (
        cur && shownRef.current && outsideRef.current === out &&
        Math.abs(cur.x - target.x) < 0.01 && Math.abs(cur.y - target.y) < 0.01
      ) return;
      targetRef.current = target;
      outsideRef.current = out;
      setOutside(out);
      setRect(out ? null : box);
      setPointer(target);
      if (!shownRef.current) {
        // first sight: appear AT the target
        shownRef.current = target;
        paint(target);
        return;
      }
      if (!raf.current) {
        lastFrame.current = performance.now();
        raf.current = requestAnimationFrame(frame);
      }
    },
    hide() {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
      shownRef.current = null;
      targetRef.current = null;
      outsideRef.current = false;
      setOutside(false);
      setRect(null);
      setPointer(null);
    },
    attach(el, onPaint) {
      elRef.current = el;
      onPaintRef.current = onPaint ?? null;
      if (el && shownRef.current) paint(shownRef.current);
    },
  };
}
