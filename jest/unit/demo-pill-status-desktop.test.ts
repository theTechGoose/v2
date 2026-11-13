/**
 * REQ-536 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 4 (run r857a9d67), issue m29: on a desktop-width customer pill the
 * "Connected" chip was a <button data-cy="demo-more"> with aria-expanded="true" whose click
 * only flipped `open` — a state the full-size pill never reads — so it did nothing a person or
 * a screen reader could see. The details toggle belongs to the phone's compact pill only; the
 * full-size pill says its status in a plain span.
 *
 * The island has no render harness in jest, so its markup is pinned on its source (the way
 * REQ-294 / REQ-373 pin it); the behaviour at both widths is the e2e story in
 * e2e/demo-mode/demo-pill-home.e2e.test.ts.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const o = fs.readFileSync(
  path.join(ROOT, "front-end/islands/DemoModeOverlay.tsx"),
  "utf8",
);
const from = o.indexOf('data-cy="demo-pill"\n        data-restarted');
const pill = o.slice(from, o.indexOf("<EndDemo", from));
/** the pill's JSX after the guide's name: the status and its toggle */
const tail = pill.slice(pill.indexOf('data-cy="demo-guide"'));

describe("REQ-536 (cycle 4, m29) the full-size pill's status is not a dead button", () => {
  test("the pill is found in the island", () => {
    expect(from).toBeGreaterThan(-1);
    expect(tail).toContain('data-cy="demo-status"');
  });

  test("the details button renders only on the compact pill", () => {
    expect(tail).toMatch(
      /compact\s*\?\s*\(\s*<button[^>]*?data-cy="demo-more"/,
    );
  });

  test("the details button is never announced as expanded when nothing can collapse", () => {
    expect(tail).not.toMatch(/aria-expanded=\{!compact \|\| open\}/);
    const more = tail.slice(tail.indexOf('data-cy="demo-more"'));
    expect(more.slice(0, more.indexOf(">"))).toMatch(/aria-expanded=\{open\}/);
  });

  test("the full-size branch shows the status in a plain span: no button, no aria-expanded", () => {
    const button = tail.indexOf("<button");
    const close = tail.indexOf("</button>", button);
    const after = tail.slice(close + "</button>".length);
    // the `: (...)` branch after the compact button
    expect(after).toMatch(
      /^\s*\)\s*:\s*\(?\s*<span[\s\S]*?data-cy="demo-status"/,
    );
    const branch = after.slice(0, after.lastIndexOf("}"));
    expect(branch).not.toContain("<button");
    expect(branch).not.toContain("aria-expanded");
    expect(branch).not.toContain("onClick");
  });
});
