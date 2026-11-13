/**
 * REQ-451 (demo M1, cycle 3) — the stage's ghost of the presenter's own arrow: where the
 * customer's screen has it now. His arrow is what he pointed at: it rides with its element when
 * their page scrolls (or the frame moves on the stage) while his own cursor stays where it was, so
 * the stage draws the arrow there, faint (GHOST_OPACITY), labelled "Your pointer on {name}'s
 * screen" — both screens, one model. Pointer events off; never drawn under his own cursor
 * (`ghostAt` decides when it shows); on the frame's edge, ringed, when its element is out of view.
 *
 * REQ-645 (demo-loop cycle 5, M1 + c4-M6) — out of view on their screen (`dir`: the way to it) the
 * customer sees a chevron at the edge of where the element can be seen (the page's scroller, not
 * the window's edge over its topbar): the ghost is that chevron there too (`data-cue`), no arrow,
 * no ring — the same thing on both screens.
 */
import { type Pt, tagPlacement } from "../../../shared/demo-mode/motion.ts";
import {
  type Dir,
  GHOST_OPACITY,
  OFF_MARK_PX,
} from "../../../shared/demo-mode/presenter-anchor.ts";
import { ARROW_H, ARROW_PATH, ARROW_W, type Bounds } from "./DemoPointer.tsx";

/** the chevron (DemoPointer's off marker), pointing right before it is turned */
const CHEVRON = "M4.5 2.5 L10 7 L4.5 11.5";

export default function PointerGhost(
  { at, outside, dir, color, z, label, bounds }: {
    at: Pt;
    outside: boolean;
    /** REQ-645 — its element is out of view that way: a chevron, not the arrow */
    dir?: Dir | null;
    color: string;
    z: number;
    label: string;
    bounds: Bounds;
  },
) {
  // the label's size, near enough: 11px bold, padded. REQ-437 placement: below-right past the
  // arrow's tail (no anchored element here), above only at the frame's bottom
  const place = tagPlacement(
    at,
    bounds,
    { w: 14 + label.length * 6.5, h: 20 },
    null,
  );
  return (
    <div
      data-cy="demo-pointer-ghost"
      data-outside={outside ? "" : undefined}
      data-cue={dir ? "" : undefined}
      aria-hidden="true"
      style={`position:fixed;left:0;top:0;width:${ARROW_W}px;height:${ARROW_H}px;overflow:visible;pointer-events:none;z-index:${z};transform:translate(${at.x}px,${at.y}px);opacity:${GHOST_OPACITY}`}
    >
      {dir
        ? (
          // REQ-645 — out of view: the chevron, centred in the arrow's box, pointing the way
          <svg
            width={OFF_MARK_PX}
            height={OFF_MARK_PX}
            viewBox="0 0 14 14"
            style={`position:absolute;left:${
              (ARROW_W - OFF_MARK_PX) / 2
            }px;top:${
              (ARROW_H - OFF_MARK_PX) / 2
            }px;overflow:visible;transform:rotate(${
              Math.round(Math.atan2(dir.dy, dir.dx) * 180 / Math.PI)
            }deg)`}
          >
            <path
              d={CHEVRON}
              fill="none"
              stroke="#fff"
              stroke-width="5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d={CHEVRON}
              fill="none"
              stroke={color}
              stroke-width="2.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        )
        : (
          <>
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
          </>
        )}
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
