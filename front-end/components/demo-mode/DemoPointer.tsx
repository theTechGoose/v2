/**
 * REQ-153 — the other side's pointer (an arrow with their name) and the waves where they clicked,
 * above everything with pointer events off. Drawn by the customer's overlay and the staff's stage.
 *
 * REQ-242 — the name tag stays inside `bounds` (the stage's frame, or the customer's window): it
 * sits right of the arrow and below it, and flips left or up near an edge (`tagPlacement`). A
 * pointer at rest stops covering what it points at: the tag fades after TAG_IDLE_MS, the arrow
 * dims after ARROW_IDLE_MS; the next move brings both back.
 */
import { useEffect, useState } from "preact/hooks";
import {
  ARROW_IDLE_MS,
  type Pt,
  TAG_DX,
  TAG_DY,
  TAG_IDLE_MS,
  tagPlacement,
} from "../../../shared/demo-mode/motion.ts";

export interface Wave {
  id: number;
  x: number;
  y: number;
}
export const WAVE_MS = 1100;

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
  { pointer, waves, name, color, z, attach, bounds }: {
    pointer: Pt | null;
    waves: Wave[];
    name: string;
    color: string;
    z: number;
    attach(el: HTMLDivElement | null): void;
    bounds?: Bounds;
  },
) {
  /** 0 moving, 1 the tag has faded, 2 the arrow has dimmed too */
  const [idle, setIdle] = useState(0);
  useEffect(() => {
    if (!pointer) return;
    setIdle(0);
    const tag = setTimeout(() => setIdle(1), TAG_IDLE_MS);
    const arrow = setTimeout(() => setIdle(2), ARROW_IDLE_MS);
    return () => {
      clearTimeout(tag);
      clearTimeout(arrow);
    };
  }, [pointer?.x, pointer?.y]);

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
          data-idle={idle}
          ref={attach}
          style={`position:fixed;left:0;top:0;width:24px;height:30px;overflow:visible;pointer-events:none;z-index:${
            z + 1
          }`}
        >
          <svg
            width="24"
            height="30"
            viewBox="0 0 22 28"
            aria-hidden="true"
            style={`position:absolute;left:0;top:0;opacity:${
              idle >= 2 ? 0.45 : 1
            };transition:opacity .4s`}
          >
            <path
              d="M2 2 L2 22 L7.5 17 L11 26 L14.5 24.5 L11 16 L18 16 Z"
              fill={color}
              stroke="#fff"
              stroke-width="1.6"
              stroke-linejoin="round"
            />
          </svg>
          <span
            data-cy="demo-pointer-tag"
            style={`position:absolute;${
              place.up ? `bottom:${30 - TAG_DY + 4}px` : `top:${TAG_DY}px`
            };${
              place.left ? `right:${TAG_DX + 2}px` : `left:${TAG_DX}px`
            };padding:2px 8px;border-radius:999px;background:${color};color:#fff;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.3);opacity:${
              idle >= 1 ? 0 : 1
            };transition:opacity .3s`}
          >
            {name}
          </span>
        </div>
      )}
    </>
  );
}
