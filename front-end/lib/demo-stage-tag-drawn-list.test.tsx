/**
 * REQ-872 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm5 (run r38fa8936), issue p12: the stage's customer cursor tag 'ML' sat over
 * the 'Español' row of the drawn native select list (fleet-r38fa8936-4/stdout:34,59).
 *
 * The replay draws an open select's list ([data-mirror-listbox], REQ-638) and the picker chip
 * ([data-mirror-picker], REQ-827) with pointer-events:none, deliberately (anchorAt must never land
 * on them), so `elementFromPoint` — which `frameCoverage` relied on — sees through them to the
 * dialog under them and scored the list as clean. `frameCoverage` now also tests those drawn
 * boxes by geometry: a list row (other than the one the arrow is on) or a chip weighs as a control.
 */
import { assert, assertEquals } from "@std/assert";
import { frameCoverage } from "../components/demo-mode/DemoPointer.tsx";
import { tagPlacement } from "../../shared/demo-mode/motion.ts";

/** the stage fits the customer's screen at half size, its frame at 400,100 */
const fit = { left: 400, top: 100, width: 640, height: 400, s: 0.5 };

type R = { left: number; top: number; width: number; height: number };
const fakeEl = (r: R, attrs: Record<string, string> = {}) => ({
  getBoundingClientRect: () => ({
    ...r,
    right: r.left + r.width,
    bottom: r.top + r.height,
  }),
  getAttribute: (n: string) => attrs[n] ?? null,
  hasAttribute: (n: string) => n in attrs,
});

/** replay px: a drawn list at x 100..300 under its select; rows English 400..430,
 *  Español 430..460, Français 460..490 */
const rowRects: R[] = [400, 430, 460].map((top) => ({
  left: 100,
  top,
  width: 200,
  height: 30,
}));
const list = fakeEl({ left: 100, top: 396, width: 200, height: 98 }, {
  "data-mirror-listbox": "",
});
const rows = rowRects.map((r) => fakeEl(r, { role: "option" }));
const chip = fakeEl({ left: 500, top: 200, width: 180, height: 26 }, {
  "data-mirror-picker": "date",
});

/** the dialog under the list: hit-testing sees only it (the list is pointer-events:none) */
const dialog = {
  tagName: "DIV",
  childNodes: [],
  matches: () => false,
  closest: () => null,
};
const replay = {
  elementFromPoint: () => dialog,
  querySelectorAll: (sel: string) => {
    const out: unknown[] = [];
    if (sel.includes("data-mirror-listbox")) out.push(list, ...rows);
    if (sel.includes("data-mirror-picker")) out.push(chip);
    return out;
  },
} as unknown as Document;

/** replay px → stage px */
const stagePt = (x: number, y: number) => ({
  x: fit.left + x * fit.s,
  y: fit.top + y * fit.s,
});

/** her mouse on 'English' (replay 120, 410) */
const tip = stagePt(120, 410);
/** a tag box over 'Español' / 'Français' (replay 140..220 × 440..484), in stage px */
const overRows = { left: 470, top: 320, width: 40, height: 22 };

Deno.test("REQ-872 (demo dm5 p12) unit: a tag over a drawn list row costs > 0 (the list is pointer-events:none, hit-testing sees the dialog)", () => {
  assert(
    frameCoverage(replay, fit, overRows, tip) > 0,
    "the tag over 'Español' scored as clean",
  );
  // well clear of the list: clean
  assertEquals(
    frameCoverage(
      replay,
      fit,
      { left: 470, top: 150, width: 40, height: 22 },
      tip,
    ),
    0,
  );
});

Deno.test("REQ-872 (demo dm5 p12) unit: another row costs as a control (3 per point), the row the arrow is on does not", () => {
  // the whole tag inside 'Español' (replay 150..230 × 432..458)
  const inEs = { left: 475, top: 316, width: 40, height: 13 };
  assertEquals(frameCoverage(replay, fit, inEs, tip), 27);
  // the whole tag inside 'English', the row her arrow is on: not "another" control
  const inEn = { left: 475, top: 301, width: 40, height: 13 };
  assert(frameCoverage(replay, fit, inEn, tip) < 27);
});

Deno.test("REQ-872 (demo dm5 p12) unit: a tag over the drawn picker chip costs as a control", () => {
  // the chip at replay 500..680 × 200..226 → stage 650..740 × 200..213
  const onChip = { left: 660, top: 201, width: 40, height: 11 };
  assertEquals(frameCoverage(replay, fit, onChip, tip), 27);
});

Deno.test("REQ-872 (demo dm5 p12) unit: tagPlacement with the stage's frame covers picks a side off the drawn list", () => {
  const box = {
    left: fit.left,
    top: fit.top,
    width: fit.width,
    height: fit.height,
  };
  const tag = { w: 26, h: 22 };
  const covers = (r: R) => frameCoverage(replay, fit, r, tip);
  const blind = tagPlacement(tip, box, tag, null);
  assertEquals(blind.side, "tail", "baseline: with no covers the tail wins");
  assert(
    covers({ left: blind.x, top: blind.y, width: tag.w, height: tag.h }) > 0,
    "baseline: the tail slot sits on the list",
  );
  const at = tagPlacement(tip, box, tag, null, covers);
  assertEquals(
    covers({ left: at.x, top: at.y, width: tag.w, height: tag.h }),
    0,
    `the tag still sits on the drawn list (side ${at.side})`,
  );
  assert(at.side !== "tail");
});

Deno.test("REQ-872 (demo dm5 p12) unit: the attributes coverage reads are the ones the replay draws its list and chip with", async () => {
  const { LISTBOX_ATTR, PICKER_ATTR } = await import(
    "./demo-mode/mirror-replay.ts"
  );
  assertEquals(LISTBOX_ATTR, "data-mirror-listbox");
  assertEquals(PICKER_ATTR, "data-mirror-picker");
});
