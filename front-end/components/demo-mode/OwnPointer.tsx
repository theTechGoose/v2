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
 *
 * REQ-813 (demo-loop cycle dm1, m4) — it says what the customer HAS (`look`): "live" at full
 * strength; "absent" (his arrow is not on their screen: their next page, a node gone) dimmed to
 * OWN_ABSENT_OPACITY, hollow, dashed, tagged "not shown" and `data-absent`; "pending" (their page
 * says "{name} is pointing…") the same words with a pulsing dot and `data-pending`. Before, it was
 * drawn at full strength under the stage's own "isn't on their screen" banner.
 */
import { useEffect, useState } from "preact/hooks";
import type { Pt } from "../../../shared/demo-mode/motion.ts";
import {
  OWN_ABSENT_OPACITY,
  type OwnLook,
} from "../../../shared/demo-mode/presenter-anchor.ts";
import { ARROW_H, ARROW_PATH, ARROW_W } from "./DemoPointer.tsx";

/** the marker is the arrow, smaller: his cursor is on top of it */
export const OWN_SCALE = 0.7;

type MarkerProps = {
  color: string;
  z: number;
  label: string;
  tagged: boolean;
  /** REQ-813 — live, absent (not on their screen) or pending ("pointing…" there) */
  look: OwnLook;
  /** REQ-813 — the tag while absent ("You · not shown") */
  absentLabel: string;
  /** REQ-813 — the words while pending ("pointing…") */
  pendingLabel: string;
};

/** REQ-813 — the marker itself, drawn at `at` (rendered on its own in tests) */
export function OwnMarker(
  { at, color, z, label, tagged, look, absentLabel, pendingLabel }:
    & MarkerProps
    & { at: Pt },
) {
  const w = ARROW_W * OWN_SCALE;
  const h = ARROW_H * OWN_SCALE;
  const absent = look === "absent";
  const pending = look === "pending";
  const tagStyle = `position:absolute;left:${w + 2}px;top:${
    h - 4
  }px;padding:0 6px;border-radius:999px;font-size:10.5px;font-weight:700;line-height:16px;white-space:nowrap`;
  return (
    <div
      data-cy="demo-pointer-own"
      data-absent={absent ? "" : undefined}
      data-pending={pending ? "" : undefined}
      aria-hidden="true"
      style={`position:fixed;left:0;top:0;width:${w}px;height:${h}px;overflow:visible;pointer-events:none;z-index:${z};transform:translate(${at.x}px,${at.y}px)${
        absent ? `;opacity:${OWN_ABSENT_OPACITY}` : ""
      }`}
    >
      {!pending && (
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
          {absent
            ? (
              // REQ-813 — hollow and dashed: where he pointed, not on their screen
              <path
                d={ARROW_PATH}
                fill="none"
                stroke={color}
                stroke-width="1.6"
                stroke-dasharray="3 2"
                stroke-linejoin="round"
              />
            )
            : (
              <path
                d={ARROW_PATH}
                fill={color}
                stroke="#1a1a1a"
                stroke-width="1.3"
                stroke-linejoin="round"
              />
            )}
        </svg>
      )}
      {pending
        ? (
          // REQ-813 — what their screen shows meanwhile: "pointing…", no arrow
          <span
            data-cy="demo-pointer-own-pending"
            style={`${tagStyle};left:0;top:0;display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.92);color:${color};border:1px solid ${color};opacity:.9`}
          >
            <span
              style={`width:7px;height:7px;border-radius:50%;background:${color};animation:pmDemoPend 1s ease-in-out infinite alternate`}
            />
            {pendingLabel}
          </span>
        )
        : absent
        ? (
          // REQ-813 — always tagged while absent: the ghost (which carries "You") is not there
          <span
            data-cy="demo-pointer-own-label"
            style={`${tagStyle};background:#fff;color:${color};border:1px dashed ${color}`}
          >
            {absentLabel}
          </span>
        )
        : tagged && (
          <span
            data-cy="demo-pointer-own-label"
            style={`${tagStyle};background:${color};color:#fff;border:1px solid #fff`}
          >
            {label}
          </span>
        )}
    </div>
  );
}

export default function OwnPointer(
  { bind, ...marker }: MarkerProps & {
    /** the stage gets the setter of where it is drawn (null: he points at nothing) */
    bind(set: (at: Pt | null) => void): void;
  },
) {
  const [at, setAt] = useState<Pt | null>(null);
  useEffect(() => bind(setAt), [bind]);
  if (!at) return null;
  return <OwnMarker at={at} {...marker} />;
}
