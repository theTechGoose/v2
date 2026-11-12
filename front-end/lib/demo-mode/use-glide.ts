/**
 * REQ-180 — the other side's pointer glides: the latest TARGET is state (so the pointer element
 * exists), the drawn position lives in a ref and is written to the element every frame until it
 * settles. Shared by the customer's overlay and the staff's stage.
 */
import { useRef, useState } from "preact/hooks";
import { glideStep, type Pt } from "../../../shared/demo-mode/motion.ts";

export interface Glide {
  pointer: Pt | null;
  /** REQ-305 — the target sits on the edge of its box, pointing at something outside it */
  outside: boolean;
  /** REQ-305 — the same target again (a pointer placed afresh after a layout change) is no move */
  glideTo(target: Pt, outside?: boolean): void;
  hide(): void;
  /** the pointer element's ref callback: paints the shown position on mount */
  attach(el: HTMLDivElement | null): void;
}

export function useGlide(): Glide {
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [outside, setOutside] = useState(false);
  const shownRef = useRef<Pt | null>(null);
  const targetRef = useRef<Pt | null>(null);
  const outsideRef = useRef(false);
  const elRef = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);
  const lastFrame = useRef(0);
  const paint = (p: Pt) => {
    const el = elRef.current;
    if (el) el.style.transform = `translate(${p.x}px,${p.y}px)`;
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
    glideTo(target, out = false) {
      const cur = targetRef.current;
      if (
        cur && shownRef.current && outsideRef.current === out &&
        Math.abs(cur.x - target.x) < 0.01 && Math.abs(cur.y - target.y) < 0.01
      ) return;
      targetRef.current = target;
      outsideRef.current = out;
      setOutside(out);
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
      setPointer(null);
    },
    attach(el) {
      elRef.current = el;
      if (el && shownRef.current) paint(shownRef.current);
    },
  };
}
