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
 */
import { useEffect, useState } from "preact/hooks";
import {
  pointerLook,
  type Pt,
  TAG_DX,
  TAG_DY,
  TAG_GAP,
  TAG_IDLE_MS,
  tagPlacement,
} from "../../../shared/demo-mode/motion.ts";

export interface Wave {
  id: number;
  x: number;
  y: number;
}
export const WAVE_MS = 1100;

/** the arrow, its tip at (2, 2) of a 22 × 28 box drawn at 24 × 30 */
const ARROW_PATH = "M2 2 L2 22 L7.5 17 L11 26 L14.5 24.5 L11 16 L18 16 Z";
const ARROW_W = 24;
const ARROW_H = 30;

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

export default function DemoPointer(
  { pointer, outside, waves, name, color, z, attach, bounds }: {
    pointer: Pt | null;
    outside?: boolean;
    waves: Wave[];
    name: string;
    color: string;
    z: number;
    attach(el: HTMLDivElement | null): void;
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

  // the tag's size, near enough: 12px bold, padded
  const tag = { w: 16 + name.length * 7.5, h: 22 };
  const place = pointer
    ? tagPlacement(pointer, bounds ?? windowBox(), tag)
    : { left: false, up: false };
  return (
    <>
      <style>
        {`@keyframes pmDemoWave{0%{transform:translate(-50%,-50%) scale(.15);opacity:.95}100%{transform:translate(-50%,-50%) scale(1);opacity:0}}`}
      </style>
      {waves.map((w) => (
        <span
          key={w.id}
          data-cy="demo-wave"
          style={`position:fixed;left:${w.x}px;top:${w.y}px;width:180px;height:180px;border-radius:50%;border:5px solid ${color};box-shadow:0 0 0 6px rgba(255,255,255,.7), 0 0 30px ${color};pointer-events:none;z-index:${z};animation:pmDemoWave ${WAVE_MS}ms ease-out forwards`}
        />
      ))}
      {pointer && (
        <div
          data-cy="demo-pointer"
          data-presenter={name}
          data-idle={idle ? 1 : 0}
          data-outside={outside ? "" : undefined}
          ref={attach}
          style={`position:fixed;left:0;top:0;width:24px;height:30px;overflow:visible;pointer-events:none;z-index:${
            z + 1
          }`}
        >
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
            data-cy="demo-pointer-tag"
            aria-hidden="true"
            style={`position:absolute;${
              place.up ? `bottom:${ARROW_H + TAG_GAP}px` : `top:${TAG_DY}px`
            };${
              place.left ? `right:${ARROW_W + TAG_GAP}px` : `left:${TAG_DX}px`
            };padding:2px 8px;border-radius:999px;background:${color};color:#fff;font-size:12px;font-weight:700;white-space:nowrap;border:1px solid rgba(255,255,255,.85);box-shadow:0 1px 4px rgba(0,0,0,.35);opacity:${look.tag};transition:opacity .3s`}
          >
            {name}
          </span>
        </div>
      )}
    </>
  );
}
