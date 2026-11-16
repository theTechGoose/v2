/**
 * REQ-844 (demo-loop cycle dm3, issue p13) — once the demo has ended, the stage pill no longer
 * offers "End demo". After "Yes, end it" (end(): 800 ms after the API answers) or an end from the
 * other side (onEnded: 1500 ms), the stage stays up until the hop to /admin; the pill read
 * "The demo ended … End demo" with a dimmed, disabled End. End is drawn only while the demo is live.
 */
import * as fs from "fs";
import * as path from "path";
import { stageEndShown } from "../../shared/demo-mode/stage-chrome.ts";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(ROOT, "front-end/islands/DemoStage.tsx"),
  "utf8",
);

describe("REQ-844 (dm3 p13) an ended stage shows no End demo", () => {
  test("stageEndShown: End is offered only while the demo is live", () => {
    expect(stageEndShown(false)).toBe(true);
    expect(stageEndShown(true)).toBe(false);
  });

  test("DemoStage draws <EndDemo> (data-cy demo-end) only behind stageEndShown(ended)", () => {
    const at = src.indexOf("<EndDemo");
    expect(at).toBeGreaterThan(-1);
    // the JSX immediately before <EndDemo is the guard
    const before = src.slice(Math.max(0, at - 120), at);
    expect(before).toMatch(/\{stageEndShown\(ended\)\s*&&\s*\(?\s*$/);
    // exactly one EndDemo on the stage
    expect(src.split("<EndDemo").length - 1).toBe(1);
  });

  test("both end paths set ended before the hop to /admin, so the guard covers both", () => {
    const endFn = src.slice(src.indexOf("async function end()"));
    expect(endFn.indexOf("setEnded(true)")).toBeGreaterThan(-1);
    expect(endFn.indexOf("setEnded(true)")).toBeLessThan(
      endFn.indexOf("backToOwnAccount"),
    );
    const onEnded = src.slice(src.indexOf("onEnded: (by, reason, pid)"));
    expect(onEnded.indexOf("setEnded(true)")).toBeGreaterThan(-1);
    expect(onEnded.indexOf("setEnded(true)")).toBeLessThan(
      onEnded.indexOf("backToOwnAccount"),
    );
  });
});
