/**
 * REQ-857 (demo-loop cycle dm4, issue p10) — once the demo has ended, the stage pill drops its
 * present-tense lines. After "Yes, end it" (end(): 800 ms after the API answers, then the hop) or an
 * end from the other side (onEnded: 1500 ms) the pill read "Demo mode | Guiding Maria Lopez |
 * Alex (you) | The demo ended | Maria Lopez's screen, 1280 × 800" until the hop to /admin. The
 * "Guiding {name}" line (with the customer dot), the presenter chips and the "{name}'s screen"
 * label are drawn only while the demo is live; once ended, only the title and "The demo ended".
 */
import * as fs from "fs";
import * as path from "path";
import { stageLiveDetailsShown } from "../../shared/demo-mode/stage-chrome.ts";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(ROOT, "front-end/islands/DemoStage.tsx"),
  "utf8",
);
const GUARD = /\{stageLiveDetailsShown\(ended\)\s*&&\s*\(?\s*(?:<>\s*)?$/;

/** the JSX between the guard and `marker`, so a guard must open right before it */
function guarded(marker: string): string {
  const at = src.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  return src.slice(Math.max(0, at - 160), at);
}

describe("REQ-857 (dm4 p10) an ended stage pill keeps only the title and 'The demo ended'", () => {
  test("stageLiveDetailsShown: live details only while the demo is live", () => {
    expect(stageLiveDetailsShown(false)).toBe(true);
    expect(stageLiveDetailsShown(true)).toBe(false);
  });

  test("the 'Guiding {name}' span (with the customer dot) sits behind stageLiveDetailsShown(ended)", () => {
    // the span that opens the customer-dot + presenting line
    const dot = src.indexOf('data-cy="demo-customer-dot"');
    // the dot is its own <span>; the line that wraps it is the <span> before that
    const spanOpen = src.lastIndexOf(
      "<span",
      src.lastIndexOf("<span", dot) - 1,
    );
    const before = src.slice(Math.max(0, spanOpen - 400), spanOpen)
      // drop JSX comments between the guard and the span
      .replace(/\{\/\*[\s\S]*?\*\/\}\s*/g, "");
    expect(before).toMatch(GUARD);
    expect(src.slice(spanOpen, src.indexOf('t("demoMode.presenting"'))).not
      .toMatch(/<\/span>\s*<\/span>/);
  });

  test("<PresenterChips> is drawn only behind stageLiveDetailsShown(ended)", () => {
    const at = src.indexOf("<PresenterChips");
    // either its own guard, or the same fragment that holds the presenting line
    const region = src.slice(
      src.lastIndexOf("stageLiveDetailsShown(ended)", at),
      at,
    );
    expect(src.lastIndexOf("stageLiveDetailsShown(ended)", at)).toBeGreaterThan(
      -1,
    );
    // nothing closes the guarded fragment between the guard and the chips
    expect(region).not.toMatch(/<\/>\s*\)\}/);
    expect(region).not.toMatch(/\{statusLabel\}/);
  });

  test("the '{name}'s screen' label (data-cy demo-screen) is drawn only while live", () => {
    expect(guarded('data-cy="demo-screen"')).toMatch(
      /\{stageLiveDetailsShown\(ended\)\s*&&\s*mirrored\s*&&\s*\(\s*<span\s*$/,
    );
  });

  test("the status chip ('The demo ended') is NOT behind the guard", () => {
    const at = src.indexOf('data-cy="demo-status"');
    const region = src.slice(src.lastIndexOf("{!endAsking && (", at), at);
    // every guard opened before the status chip is closed before it
    const opened = region.split("stageLiveDetailsShown(ended)").length - 1;
    const closed = (region.match(/<\/>\s*\)\}/g) ?? []).length +
      (region.match(/<\/span>\s*\)\}/g) ?? []).length;
    expect(closed).toBe(opened);
  });
});
