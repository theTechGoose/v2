/**
 * REQ-217 — one demo viewer per customer: the tab they are looking at.
 * REQ-793 (amends REQ-217) — the worker view is a page of the app: eligible like the rest.
 */
import * as fs from "fs";
import * as path from "path";
import { demoEligible, viewerTab } from "../../shared/demo-mode/tab";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-217 which tab speaks for the customer", () => {
  test("REQ-793: the worker view is eligible like every page of the app", () => {
    expect(demoEligible("/worker")).toBe(true);
    expect(demoEligible("/worker/")).toBe(true);
    expect(demoEligible("/worker?lang=en")).toBe(true);
    expect(demoEligible("/worker/tasks")).toBe(true);
    expect(demoEligible("/dashboard")).toBe(true);
    expect(demoEligible("/assistant")).toBe(true);
    expect(demoEligible("/customers")).toBe(true);
    expect(demoEligible("/workers-not-the-portal")).toBe(true);
    expect(demoEligible("/field/workers")).toBe(true);
  });

  test("only a visible tab is the viewer", () => {
    expect(viewerTab("visible")).toBe(true);
    expect(viewerTab("hidden")).toBe(false);
    expect(viewerTab("prerender")).toBe(false);
    expect(viewerTab(undefined)).toBe(false);
  });

  test("the overlay is inert on an ineligible page, asks only while visible, and keys its link on visibility", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    expect(src).toMatch(
      /import \{ demoEligible, viewerTab \} from "\.\.\/\.\.\/shared\/demo-mode\/tab\.ts"/,
    );
    expect(src).toMatch(/!demoEligible\(globalThis\.location\.pathname\)/);
    expect(src).toMatch(
      /if \(!viewerTab\(document\.visibilityState\)\) return;/,
    );
    expect(src).toMatch(/demo\.role !== "viewer" \|\| !visible\) return;/);
    expect(src).toMatch(/\}, \[demo\?\.id, visible\]\);/);
  });
});
