/**
 * REQ-180 — the other side's pointer glides: the latest TARGET is state (so the pointer element
 * exists), the drawn position lives in a ref and is written to the element every frame until it
 * settles. Shared by the customer's overlay and the staff's stage.
 */
import { useRef, useState } from "preact/hooks";
import { glideStep, type Pt } from "../../../shared/demo-mode/motion.ts";

export interface Glide {
  pointer: Pt | null;
  glideTo(target: Pt): void;
  hide(): void;
  /** the pointer element's ref callback: paints the shown position on mount */
  attach(el: HTMLDivElement | null): void;
}

export function useGlide(): Glide {
  const [pointer, setPointer] = useState<Pt | null>(null);
  const shownRef = useRef<Pt | null>(null);
  const targetRef = useRef<Pt | null>(null);
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
    glideTo(target) {
      targetRef.current = target;
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
      setPointer(null);
    },
    attach(el) {
      elRef.current = el;
      if (el && shownRef.current) paint(shownRef.current);
    },
  };
}
