/**
 * REQ-825 — demo-loop cycle dm2, issue p9: on the 404 page the customer's demo pill was drawn in
 * a monospace face in the headless box while the stage's ghost read in Inter. The stage
 * (demo-stage.css) and every app page (dashboard.css / assistant.css) load Inter from Google
 * Fonts; the 404 page (routes/_error.tsx → error-page.css) loaded none, so PILL_FONT fell
 * through to system-ui / sans-serif — which a box without a system-ui face maps to monospace.
 * REQ-294 gave the 404's body the same stack, which changed nothing.
 */
import * as fs from "fs";
import * as path from "path";
import { PILL_FONT } from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** the Inter webfont request the stage uses (demo-stage.css) */
const INTER_IMPORT =
  /@import url\("https:\/\/fonts\.googleapis\.com\/css2\?[^"]*family=Inter[:&"][^"]*"\);/;

const families = (stack: string) =>
  stack.split(",").map((f) => f.trim().replace(/^"|"$/g, ""));

describe("REQ-825 the 404 page loads Inter, like the stage (demo dm2 p9)", () => {
  test("the stage's stylesheet loads Inter (the reference)", () => {
    expect(read("front-end/static/demo-stage.css")).toMatch(INTER_IMPORT);
  });

  test("error-page.css (the only stylesheet _error.tsx links) loads Inter", () => {
    const e = read("front-end/routes/_error.tsx");
    expect(e).toMatch(/href=\{asset\("\/error-page\.css"\)\}/);
    const css = read("front-end/static/error-page.css");
    expect(css).toMatch(INTER_IMPORT);
    // an @import only counts before every other rule
    const firstRule = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(firstRule.startsWith("@import")).toBe(true);
  });

  test("the 404 body names Inter first and ends on a concrete sans before the generic", () => {
    const css = read("front-end/static/error-page.css");
    const body = css.match(/body\s*\{[^}]*font-family:\s*([^;]+);/)?.[1] ?? "";
    const f = families(body);
    expect(f[0]).toBe("Inter");
    expect(f.indexOf("Arial")).toBeGreaterThan(-1);
    expect(f.indexOf("Arial")).toBeLessThan(f.indexOf("sans-serif"));
  });
});

describe("REQ-825 PILL_FONT never ends on a bare generic (demo dm2 p9)", () => {
  test("Inter first, then concrete installed sans faces (Arial, Helvetica) before sans-serif", () => {
    const f = families(PILL_FONT);
    expect(f[0]).toBe("Inter");
    expect(f[f.length - 1]).toBe("sans-serif");
    const arial = f.indexOf("Arial");
    const helvetica = f.indexOf("Helvetica");
    expect(arial).toBeGreaterThan(0);
    expect(helvetica).toBeGreaterThan(0);
    expect(arial).toBeLessThan(f.indexOf("sans-serif"));
    expect(helvetica).toBeLessThan(f.indexOf("sans-serif"));
    expect(f).not.toContain("monospace");
  });

  test("the stage ghost and the customer pill both draw with PILL_FONT", () => {
    expect(read("front-end/islands/DemoModeOverlay.tsx")).toContain(
      "font-family:${PILL_FONT}",
    );
    expect(read("front-end/islands/DemoStage.tsx")).toContain(
      "font-family:${PILL_FONT}",
    );
  });
});
