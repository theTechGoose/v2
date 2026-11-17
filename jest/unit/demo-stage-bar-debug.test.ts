/**
 * REQ-650 (demo-loop cycle 5, issue c4-m1) — the staff stage bar is a product bar, not a debug
 * console. The mirror's counters ("mirror f477 hb299 …") showed on every stage served from
 * localhost, so every demo run saw them; the bar wrapped, End demo dropped to a second line and
 * the frame shrank. And End's question ("End for everyone? Yes, end it · Keep going") was ADDED to
 * the pill's spans, so it widened (and wrapped) the pill, whose measured height is the frame's
 * bottom inset (REQ-228): the frame resized while End asked.
 *
 * Now the counters show only behind an explicit debug flag (?debug=1, or localStorage
 * `pm_demo_debug` = "1"), never by hostname; while End asks, its question REPLACES the pill's
 * spans, and the frame's bottom inset keeps the resting pill's height.
 */
import * as fs from "fs";
import * as path from "path";
import {
  STAGE_DEBUG_KEY,
  stageDebugOn,
  stagePillH,
} from "../../shared/demo-mode/stage-chrome.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const stage = read("front-end/islands/DemoStage.tsx");

describe("REQ-650 (cycle 5, c4-m1) the stage bar: counters behind a debug flag, End's question never resizes the frame", () => {
  test("REQ-650 stageDebugOn: only ?debug=1 or the stored flag turns the counters on", () => {
    expect(STAGE_DEBUG_KEY).toBe("pm_demo_debug");
    // a plain stage — on localhost too — shows no counters
    expect(stageDebugOn("", null)).toBe(false);
    expect(stageDebugOn("?demo=abc", null)).toBe(false);
    expect(stageDebugOn("?debug=0", null)).toBe(false);
    expect(stageDebugOn("", "0")).toBe(false);
    // the explicit flag, in the address or remembered by the tab's storage
    expect(stageDebugOn("?debug=1", null)).toBe(true);
    expect(stageDebugOn("?x=1&debug=1", null)).toBe(true);
    expect(stageDebugOn("", "1")).toBe(true);
    // ?debug=0 wins over a stored flag (switch it off for one look)
    expect(stageDebugOn("?debug=0", "1")).toBe(false);
  });

  test("REQ-650 stagePillH: while End asks, the frame's inset keeps the resting pill's height", () => {
    expect(stagePillH(44, 88, true)).toBe(44);
    expect(stagePillH(44, 30, true)).toBe(44);
    // at rest it follows the pill (a narrow window's wrap, a new status — REQ-228)
    expect(stagePillH(44, 88, false)).toBe(88);
    // nothing measured yet: the first measure counts even while asking
    expect(stagePillH(0, 44, true)).toBe(44);
  });

  test("REQ-650 DemoStage decides dev by the debug flag, never by the hostname", () => {
    expect(stage).not.toMatch(/localhost\|127/);
    expect(stage).not.toMatch(/location\.hostname/);
    // the stored flag is read, then the address and it decide together
    expect(stage).toMatch(
      /localStorage\.getItem\(STAGE_DEBUG_KEY\)[\s\S]{0,200}stageDebugOn\(location\.search, stored\)/,
    );
  });

  test("REQ-650 DemoStage: End's question replaces the pill's spans, and the inset is frozen while it asks", () => {
    expect(stage).toMatch(/<EndDemo[^>]*onAsking=\{setEndAsking\}/);
    // the measured height goes through stagePillH with the asking state
    expect(stage).toMatch(
      /stagePillH\(\s*h,\s*el\.getBoundingClientRect\(\)\.height,\s*endAskingRef\.current/,
    );
    // everything between the title and End is drawn only while End is not asking
    const pill = stage.slice(stage.indexOf('data-cy="demo-pill"'));
    const body = pill.slice(
      pill.indexOf("</strong>"),
      pill.indexOf("<EndDemo"),
    );
    expect(body.trimStart()).toMatch(
      /^<\/strong>\s*(\{\/\*[^*]*\*\/\}\s*)?\{!endAsking && \(/,
    );
    for (
      const cy of [
        "demo-customer-dot",
        "demo-status",
        "demo-mirror-stats",
        "demo-screen",
        "demo-leave",
      ]
    ) {
      expect(body).toContain(`data-cy="${cy}"`);
    }
  });
});
