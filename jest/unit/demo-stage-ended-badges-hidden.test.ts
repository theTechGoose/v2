/**
 * REQ-868 (demo-loop cycle dm5, issue p8) — once the demo has ended, the stage's chrome-row badges
 * are gone. After "Yes, end it" (end(): 800 ms after the API answers, then the hop) or an end from
 * the other side (onEnded: 1500 ms) the stage read "Your pointer is off Maria Lopez's screen |
 * Demo mode | The demo ended" until the hop to /admin: the pointer-off badge (and the tab-switched
 * and pointer-absent badges, same pattern) had no `ended` guard. All three share one gate,
 * `stageBadgesShown`, which is false once ended; the end handlers also clear the badges' state.
 */
import * as fs from "fs";
import * as path from "path";
import { stageBadgesShown } from "../../shared/demo-mode/stage-chrome.ts";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(ROOT, "front-end/islands/DemoStage.tsx"),
  "utf8",
);

/** the JSX condition that opens the `<div data-cy=…>` badge: from the `{` before it */
function condition(cy: string): string {
  const at = src.indexOf(`data-cy="${cy}"`);
  expect(at).toBeGreaterThan(-1);
  const div = src.lastIndexOf("<div", at);
  const open = src.lastIndexOf("{", div);
  return src.slice(open, div);
}

/** the body of a function or handler starting at `marker`, up to the next `setTimeout(` */
function bodyUntilHop(marker: string): string {
  const at = src.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const hop = src.indexOf("setTimeout(", at);
  return src.slice(at, hop);
}

describe("REQ-868 (dm5 p8) an ended stage drops its chrome-row badges", () => {
  test("stageBadgesShown: only while live, mirrored, not elsewhere, not waiting", () => {
    const live = {
      ended: false,
      mirrored: true,
      elsewhere: false,
      waiting: false,
    };
    expect(stageBadgesShown(live)).toBe(true);
    expect(stageBadgesShown({ ...live, ended: true })).toBe(false);
    expect(stageBadgesShown({ ...live, mirrored: false })).toBe(false);
    expect(stageBadgesShown({ ...live, elsewhere: true })).toBe(false);
    expect(stageBadgesShown({ ...live, waiting: true })).toBe(false);
  });

  test("the stage's one badge gate is stageBadgesShown({ ended, … })", () => {
    expect(src).toMatch(
      /const badges = stageBadgesShown\(\{[^}]*\bended\b[^}]*\}\)/,
    );
  });

  for (
    const cy of ["demo-pointer-off", "demo-tab-switched", "demo-pointer-absent"]
  ) {
    test(`the ${cy} badge opens on that gate`, () => {
      expect(condition(cy)).toMatch(/^\{\s*badges\s*&&/);
    });
  }

  test("onEnded and end() clear the badges' state before the hop", () => {
    for (const marker of ["onEnded: (", "async function end()"]) {
      const body = bodyUntilHop(marker);
      expect(body).toMatch(/setOff\(false\)/);
      expect(body).toMatch(/setTabNote\(null\)/);
      expect(body).toMatch(/setAbsent\(false\)/);
    }
  });
});
