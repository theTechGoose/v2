/**
 * REQ-153 — the other side's pointer (an arrow with their name) and the waves where they clicked,
 * above everything with pointer events off. Drawn by the customer's overlay and the staff's stage.
 */
import type { Pt } from "../../../shared/demo-mode/motion.ts";

export interface Wave {
  id: number;
  x: number;
  y: number;
}
export const WAVE_MS = 1100;

export default function DemoPointer(
  { pointer, waves, name, color, z, attach }: {
    pointer: Pt | null;
    waves: Wave[];
    name: string;
    color: string;
    z: number;
    attach(el: HTMLDivElement | null): void;
  },
) {
  // the name tag sits right of the arrow, left of it near the right edge so it is never cut off
  const flip = pointer !== null &&
    pointer.x > (globalThis.innerWidth || 0) - 180;
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
            style="position:absolute;left:0;top:0"
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
            style={`position:absolute;top:18px;${
              flip ? "right:28px" : "left:26px"
            };padding:2px 8px;border-radius:999px;background:${color};color:#fff;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.3)`}
          >
            {name}
          </span>
        </div>
      )}
    </>
  );
}
