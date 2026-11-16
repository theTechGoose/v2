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
 * REQ-847 (demo-loop cycle dm3, p16) — out of view too the cue sits where the customer's cue is
 * (`tag`, their report); with no report its words are placed in the customer's px (`scale`: the
 * frame's s), so `tagPlacement`'s px offsets (the tail 36 px under the tip) mean the same on both
 * screens — not 36 stage px, ≈ 42 of theirs at s 0.86.
 * REQ-843 (demo-loop cycle dm3, p15) — for his own ghost the words are his own (`ownCueKey`:
 * "You · pointing below — the customer must scroll ↓"), never his name after "You ·".
 * REQ-860 (demo-loop cycle dm4, m5) — the customer's tag offset is kept, but clamped TAG_EDGE
 * inside the cue's box (else the frame): her words are shorter than the stage's.
 * REQ-877 (demo-loop cycle dm5, m1) — his mouse beside the frame (`off`, from `reportedGhost`):
 * their screen shows the off marker — a chevron against its edge and his initial on a dot, no tag
 * (REQ-635) — for OFF_MARK_SHOW_MS, faded out over OFF_MARK_FADE_MS. The ghost is that marker,
 * faint, on the frame's same edge (`offMark`, `offBadge`), keyed on her marker's spot (`off.key`)
 * with the same pmDemoOffFade (`OFF_FADE_KEYFRAMES`): a new spot restarts both fades, and it is
 * gone when hers is. Before, the stage drew nothing there while her screen showed his initial.
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
  OFF_BADGE_PX,
  OFF_FADE_KEYFRAMES,
  OFF_MARK_FADE_MS,
  OFF_MARK_PX,
  OFF_MARK_SHOW_MS,
  offBadge,
  offMark,
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

/** REQ-847 — the cue's words placed as the customer's overlay places them, in THEIR px (the
 *  stage's divided by `s`), then drawn back at the stage's scale */
function cueIn(
  at: Pt,
  area: Rect,
  size: { w: number; h: number },
  s: number,
) {
  const k = s > 0 ? s : 1;
  const p = tagPlacement(
    { x: at.x / k, y: at.y / k },
    {
      left: area.left / k,
      top: area.top / k,
      width: area.width / k,
      height: area.height / k,
    },
    { w: size.w / k, h: size.h / k },
    null,
  );
  return { x: p.x * k, y: p.y * k, side: p.side };
}

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
    scale,
    off,
    initial,
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
    /** REQ-642 — would a tag at this box cover another control. REQ-848 (demo dm3 m4) — or how
     *  much it would hide, by the stage's hit-test of its replay (`frameCoverage`) */
    covers?: (r: Rect, at: Pt) => boolean | number;
    /** REQ-837 — where the customer's tag is, beside the arrow, in the stage's px */
    tag?: TagPlace | null;
    /** REQ-837 — out of view: the words the customer reads (the way to the element) */
    cueText?: string;
    /** REQ-837 — out of view: the box the element can be seen in (the cue's words stay inside) */
    cueBox?: Rect | null;
    /** REQ-847 — the frame's scale (stage px per customer px): the cue is placed in theirs */
    scale?: number;
    /** REQ-877 — his mouse beside the frame: their off marker, keyed on its spot (`key`) */
    off?: { key: string } | null;
    /** REQ-877 — his initial, as their off marker shows it */
    initial?: string;
  },
) {
  if (off) {
    // REQ-877 (demo dm5 m1) — the off marker their screen has: chevron + initial, no tag, the
    // same fade (DemoPointer's off branch, drawn faint)
    const m = offMark(at, bounds);
    const b = offBadge(at, bounds);
    return (
      <div
        data-cy="demo-pointer-ghost"
        data-outside=""
        data-off=""
        aria-hidden="true"
        style={`position:fixed;left:0;top:0;width:${ARROW_W}px;height:${ARROW_H}px;overflow:visible;pointer-events:none;z-index:${z};transform:translate(${at.x}px,${at.y}px);opacity:${GHOST_OPACITY}`}
      >
        <style>{OFF_FADE_KEYFRAMES}</style>
        <span
          key={off.key}
          data-cy="demo-pointer-ghost-off-mark"
          style={`position:absolute;left:${m.left}px;top:${m.top}px;width:${OFF_MARK_PX}px;height:${OFF_MARK_PX}px;opacity:0;animation:pmDemoOffFade ${
            OFF_MARK_SHOW_MS + OFF_MARK_FADE_MS
          }ms linear forwards`}
        >
          <svg
            width={OFF_MARK_PX}
            height={OFF_MARK_PX}
            viewBox="0 0 14 14"
            style={`position:absolute;left:0;top:0;overflow:visible;transform:rotate(${m.deg}deg)`}
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
          <span
            data-cy="demo-pointer-ghost-off-initial"
            style={`position:absolute;left:${b.left}px;top:${b.top}px;width:${OFF_BADGE_PX}px;height:${OFF_BADGE_PX}px;border-radius:50%;background:${color};color:#fff;border:1.5px solid #fff;box-sizing:border-box;font:700 9px/13px system-ui,sans-serif;text-align:center;white-space:nowrap`}
          >
            {initial ?? ""}
          </span>
        </span>
      </div>
    );
  }
  const cue = dir && cueText ? cueText : null;
  const words = cue ? `${label} · ${cue}` : label;
  const box = outside || cue ? null : rect ?? null;
  const doc = globalThis.document;
  const hit = covers
    ? (r: Rect) => covers(r, at)
    : doc && box
    ? (r: Rect) => coversControl(doc, r, at)
    : undefined;
  // the label's size, near enough: 11px bold, padded. REQ-437 + REQ-642: outside the anchored
  // element, next to the arrow, off the other controls; else below-right past the arrow's tail.
  // REQ-837 — where the customer's tag is when they said; the cue's words inside `cueBox`
  const size = { w: 14 + words.length * 6.5, h: 20 };
  const place = tag
    ? (() => {
      // REQ-860 (demo dm4 m5) — kept inside the cue's box / the frame: the stage's words are
      // wider than the customer's, whose tag this is
      const p = alignTag(tag, size, at, cue ? cueBox ?? bounds : bounds);
      return { x: at.x + p.left, y: at.y + p.top, side: tag.side };
    })()
    : cue
    ? cueIn(at, cueBox ?? bounds, size, scale ?? 1)
    : tagPlacement(at, bounds, size, box, hit);
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
