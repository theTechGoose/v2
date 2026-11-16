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
 * REQ-642 (demo-loop cycle 5, m10) — drawn where the customer's overlay REPORTED the arrow
 * (`reportedGhost`), tagged "You" (short), and the tag is placed like DemoPointer's: outside the
 * anchored element (`rect`), next to the arrow, off the other controls under it (`covers`; by
 * default a hit-test of the page through the stage's mirror, `coversControl`).
 * REQ-789 — drawn only once he has rested (the stage's `ghostWait`), and it fades in rather than
 * popping up beside his cursor.
 * REQ-837 (demo-loop cycle dm2, m3 + p3) — the tag sits where the customer's tag is (`tag`: the
 * side and offset their overlay reported, in the stage's px), else placed as above. Out of view
 * (`dir`) it carries the words the customer reads (`cueText`: "Hans is pointing below — scroll ↓",
 * after "You ·"), placed inside the box the element can be seen in (`cueBox`), not only "You".
 * REQ-843 (demo-loop cycle dm3, p15) — for his own ghost the words are his own (`ownCueKey`:
 * "You · pointing below — the customer must scroll ↓"), never his name after "You ·".
 */
import {
  type Pt,
  type Rect,
  tagPlacement,
} from "../../../shared/demo-mode/motion.ts";
import {
  alignTag,
  cueMarkOffset,
  type Dir,
  GHOST_OPACITY,
  OFF_MARK_PX,
  type TagPlace,
} from "../../../shared/demo-mode/presenter-anchor.ts";
import {
  ARROW_H,
  ARROW_PATH,
  ARROW_W,
  type Bounds,
  coversControl,
} from "./DemoPointer.tsx";

/** the chevron (DemoPointer's off marker), pointing right before it is turned */
const CHEVRON = "M4.5 2.5 L10 7 L4.5 11.5";

export default function PointerGhost(
  {
    at,
    outside,
    dir,
    color,
    z,
    label,
    bounds,
    rect,
    covers,
    tag,
    cueText,
    cueBox,
  }: {
    at: Pt;
    outside: boolean;
    /** REQ-645 — its element is out of view that way: a chevron, not the arrow */
    dir?: Dir | null;
    color: string;
    z: number;
    label: string;
    bounds: Bounds;
    /** REQ-642 — the box of the element his anchor names on the stage (null: none, out of view) */
    rect?: Rect | null;
    /** REQ-642 — would a tag at this box cover another control */
    covers?: (r: Rect) => boolean;
    /** REQ-837 — where the customer's tag is, beside the arrow, in the stage's px */
    tag?: TagPlace | null;
    /** REQ-837 — out of view: the words the customer reads (the way to the element) */
    cueText?: string;
    /** REQ-837 — out of view: the box the element can be seen in (the cue's words stay inside) */
    cueBox?: Rect | null;
  },
) {
  const cue = dir && cueText ? cueText : null;
  const words = cue ? `${label} · ${cue}` : label;
  const box = outside || cue ? null : rect ?? null;
  const doc = globalThis.document;
  const hit = covers ??
    (doc && box ? (r: Rect) => coversControl(doc, r, at) : undefined);
  // the label's size, near enough: 11px bold, padded. REQ-437 + REQ-642: outside the anchored
  // element, next to the arrow, off the other controls; else below-right past the arrow's tail.
  // REQ-837 — where the customer's tag is when they said; the cue's words inside `cueBox`
  const size = { w: 14 + words.length * 6.5, h: 20 };
  const place = tag
    ? (() => {
      const p = alignTag(tag, size);
      return { x: at.x + p.left, y: at.y + p.top, side: tag.side };
    })()
    : tagPlacement(at, cue ? cueBox ?? bounds : bounds, size, box, hit);
  const mark = dir ? cueMarkOffset(dir) : null;
  return (
    <div
      data-cy="demo-pointer-ghost"
      data-outside={outside ? "" : undefined}
      data-cue={dir ? "" : undefined}
      aria-hidden="true"
      style={`position:fixed;left:0;top:0;width:${ARROW_W}px;height:${ARROW_H}px;overflow:visible;pointer-events:none;z-index:${z};transform:translate(${at.x}px,${at.y}px);opacity:${GHOST_OPACITY};animation:pmDemoGhostIn .25s ease-out`}
    >
      <style>
        {`@keyframes pmDemoGhostIn{from{opacity:0}to{opacity:${GHOST_OPACITY}}}`}
      </style>
      {mark
        ? (
          // REQ-645 — out of view: the chevron, pointing the way. REQ-815 — placed in the arrow's
          // box as the customer's is (`cueMarkOffset`): against the edge, centred on the tip
          <svg
            width={OFF_MARK_PX}
            height={OFF_MARK_PX}
            viewBox="0 0 14 14"
            style={`position:absolute;left:${mark.left}px;top:${mark.top}px;overflow:visible;transform:rotate(${mark.deg}deg)`}
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
        data-cy={cue ? "demo-pointer-ghost-cue" : "demo-pointer-ghost-label"}
        data-tag-side={place.side}
        style={`position:absolute;left:${place.x - at.x}px;top:${
          place.y - at.y
        }px;padding:1px 7px;border-radius:999px;background:${color};color:#fff;font-size:11px;font-weight:700;white-space:nowrap;border:1px dashed rgba(255,255,255,.9)`}
      >
        {words}
      </span>
    </div>
  );
}
