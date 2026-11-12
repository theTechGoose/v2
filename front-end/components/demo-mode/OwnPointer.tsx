/**
 * REQ-642 (demo-loop cycle 5, m10 + setup-14d) — the presenter's OWN pointer, always drawn on the
 * stage where he pointed (the anchor he sent): a small arrow in his colour, tagged "You". Before,
 * the stage drew nothing of his own unless his arrow on the customer's screen was apart from his
 * cursor, so a reviewer's screenshot or his shared screen (no OS cursor in either) showed only
 * the customer's orange arrow — and pair 6 took it for his own. Never the customer's colour, never
 * their name; pointer events off (it sits under his cursor). The tag is left off while the ghost
 * carries it (`tagged`): one "You" on the stage at a time.
 *
 * It moves on every anchor he sends: the stage hands it the position through `bind` (its own
 * state), so a move re-renders this marker only, never the whole stage.
 */
import { useEffect, useState } from "preact/hooks";
import type { Pt } from "../../../shared/demo-mode/motion.ts";
import { ARROW_H, ARROW_PATH, ARROW_W } from "./DemoPointer.tsx";

/** the marker is the arrow, smaller: his cursor is on top of it */
export const OWN_SCALE = 0.7;

export default function OwnPointer(
  { color, z, label, tagged, bind }: {
    color: string;
    z: number;
    label: string;
    tagged: boolean;
    /** the stage gets the setter of where it is drawn (null: he points at nothing) */
    bind(set: (at: Pt | null) => void): void;
  },
) {
  const [at, setAt] = useState<Pt | null>(null);
  useEffect(() => bind(setAt), [bind]);
  if (!at) return null;
  const w = ARROW_W * OWN_SCALE;
  const h = ARROW_H * OWN_SCALE;
  return (
    <div
      data-cy="demo-pointer-own"
      aria-hidden="true"
      style={`position:fixed;left:0;top:0;width:${w}px;height:${h}px;overflow:visible;pointer-events:none;z-index:${z};transform:translate(${at.x}px,${at.y}px)`}
    >
      <svg
        width={w}
        height={h}
        viewBox="0 0 22 28"
        style="position:absolute;left:0;top:0;overflow:visible"
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
      {tagged && (
        <span
          data-cy="demo-pointer-own-label"
          style={`position:absolute;left:${w + 2}px;top:${
            h - 4
          }px;padding:0 6px;border-radius:999px;background:${color};color:#fff;font-size:10.5px;font-weight:700;line-height:16px;white-space:nowrap;border:1px solid #fff`}
        >
          {label}
        </span>
      )}
    </div>
  );
}
