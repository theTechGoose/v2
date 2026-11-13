/**
 * REQ-217 — one demo viewer per customer: the tab they are looking at; the worker portal never.
 */
import * as fs from "fs";
import * as path from "path";
import { demoEligible, viewerTab } from "../../shared/demo-mode/tab";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-217 which tab speaks for the customer", () => {
  test("the worker portal is never eligible; the app's pages are", () => {
    expect(demoEligible("/worker")).toBe(false);
    expect(demoEligible("/worker/")).toBe(false);
    expect(demoEligible("/worker/tasks")).toBe(false);
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
    expect(src).toMatch(/import \{ demoEligible, viewerTab \} from "\.\.\/\.\.\/shared\/demo-mode\/tab\.ts"/);
    expect(src).toMatch(/!demoEligible\(globalThis\.location\.pathname\)/);
    expect(src).toMatch(/if \(!viewerTab\(document\.visibilityState\)\) return;/);
    expect(src).toMatch(/demo\.role !== "viewer" \|\| !visible\) return;/);
    expect(src).toMatch(/\}, \[demo\?\.id, visible\]\);/);
  });
});
