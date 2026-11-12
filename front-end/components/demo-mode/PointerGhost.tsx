/**
 * REQ-451 (demo M1, cycle 3) — the stage's ghost of the presenter's own arrow: where the
 * customer's screen has it now. His arrow is what he pointed at: it rides with its element when
 * their page scrolls (or the frame moves on the stage) while his own cursor stays where it was, so
 * the stage draws the arrow there, faint (GHOST_OPACITY), labelled "Your pointer on {name}'s
 * screen" — both screens, one model. Pointer events off; never drawn under his own cursor
 * (`ghostAt` decides when it shows); on the frame's edge, ringed, when its element is out of view.
 */
import {
  type Pt,
  TAG_DX,
  TAG_DY,
  TAG_GAP,
  tagPlacement,
} from "../../../shared/demo-mode/motion.ts";
import { GHOST_OPACITY } from "../../../shared/demo-mode/presenter-anchor.ts";
import { ARROW_H, ARROW_PATH, ARROW_W, type Bounds } from "./DemoPointer.tsx";

export default function PointerGhost(
  { at, outside, color, z, label, bounds }: {
    at: Pt;
    outside: boolean;
    color: string;
    z: number;
    label: string;
    bounds: Bounds;
  },
) {
  // the label's size, near enough: 11px bold, padded
  const place = tagPlacement(at, bounds, { w: 14 + label.length * 6.5, h: 20 });
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
        style={`position:absolute;${
          place.up ? `bottom:${ARROW_H + TAG_GAP}px` : `top:${TAG_DY}px`
        };${
          place.left ? `right:${ARROW_W + TAG_GAP}px` : `left:${TAG_DX}px`
        };padding:1px 7px;border-radius:999px;background:${color};color:#fff;font-size:11px;font-weight:700;white-space:nowrap;border:1px dashed rgba(255,255,255,.9)`}
      >
        {label}
      </span>
    </div>
  );
}
