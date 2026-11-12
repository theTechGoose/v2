/**
 * REQ-451 (demo M1, cycle 3) — the stage's ghost of the presenter's own arrow: where the
 * customer's screen has it now. His arrow is what he pointed at: it rides with its element when
 * their page scrolls (or the frame moves on the stage) while his own cursor stays where it was, so
 * the stage draws the arrow there, faint (GHOST_OPACITY), labelled "Your pointer on {name}'s
 * screen" — both screens, one model. Pointer events off; never drawn under his own cursor
 * (`ghostAt` decides when it shows); on the frame's edge, ringed, when its element is out of view.
 *
 * REQ-642 (demo-loop cycle 5, m10) — drawn where the customer's overlay REPORTED the arrow
 * (`reportedGhost`), tagged "You" (short), and the tag is placed like DemoPointer's: outside the
 * anchored element (`rect`), next to the arrow, off the other controls under it (`covers`; by
 * default a hit-test of the page through the stage's mirror, `coversControl`).
 */
import {
  type Pt,
  type Rect,
  tagPlacement,
} from "../../../shared/demo-mode/motion.ts";
import { GHOST_OPACITY } from "../../../shared/demo-mode/presenter-anchor.ts";
import {
  ARROW_H,
  ARROW_PATH,
  ARROW_W,
  type Bounds,
  coversControl,
} from "./DemoPointer.tsx";

export default function PointerGhost(
  { at, outside, color, z, label, bounds, rect, covers }: {
    at: Pt;
    outside: boolean;
    color: string;
    z: number;
    label: string;
    bounds: Bounds;
    /** REQ-642 — the box of the element his anchor names on the stage (null: none, out of view) */
    rect?: Rect | null;
    /** REQ-642 — would a tag at this box cover another control */
    covers?: (r: Rect) => boolean;
  },
) {
  const box = outside ? null : rect ?? null;
  const doc = globalThis.document;
  const hit = covers ??
    (doc && box ? (r: Rect) => coversControl(doc, r, at) : undefined);
  // the label's size, near enough: 11px bold, padded. REQ-437 + REQ-642: outside the anchored
  // element, next to the arrow, off the other controls; else below-right past the arrow's tail
  const place = tagPlacement(
    at,
    bounds,
    { w: 14 + label.length * 6.5, h: 20 },
    box,
    hit,
  );
  return (
    <div
      data-cy="demo-pointer-ghost"
      data-outside={outside ? "" : undefined}
      aria-hidden="true"
      style={`position:fixed;left:0;top:0;width:${ARROW_W}px;height:${ARROW_H}px;overflow:visible;pointer-events:none;z-index:${z};transform:translate(${at.x}px,${at.y}px);opacity:${GHOST_OPACITY}`}
    >
      {outside && (
        <span
          style={`position:absolute;left:-8px;top:-8px;width:36px;height:36px;border-radius:50%;border:2px dashed ${color}`}
        />
      )}
      <svg
        width={ARROW_W}
        height={ARROW_H}
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
      <span
        data-cy="demo-pointer-ghost-label"
        data-tag-side={place.side}
        style={`position:absolute;left:${place.x - at.x}px;top:${
          place.y - at.y
        }px;padding:1px 7px;border-radius:999px;background:${color};color:#fff;font-size:11px;font-weight:700;white-space:nowrap;border:1px dashed rgba(255,255,255,.9)`}
      >
        {label}
      </span>
    </div>
  );
}
