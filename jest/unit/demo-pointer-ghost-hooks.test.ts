/**
 * REQ-877 AMENDMENT 2 (demo-fixes lint, 2026-11-17) — PointerGhost's fade ref is a hook; it must
 * run on EVERY render. REQ-877's off-marker branch returned before it, so a ghost that went from
 * off to in (or back) rendered with a different hook count (deno lint react-rules-of-hooks).
 */
import * as fs from "fs";
import * as path from "path";

const src = fs.readFileSync(
  path.join(__dirname, "../../front-end/components/demo-mode/PointerGhost.tsx"),
  "utf8",
);

describe("REQ-877 AMENDMENT 2: PointerGhost calls its hook before any branch returns", () => {
  test("useRef comes before the off-marker branch's early return", () => {
    const body = src.slice(src.indexOf("export default function PointerGhost("));
    const hook = body.indexOf("useRef<");
    const offBranch = body.indexOf("if (off) {");
    expect(hook).toBeGreaterThan(0);
    expect(offBranch).toBeGreaterThan(0);
    expect(hook).toBeLessThan(offBranch);
  });
  test("the hook's first-render value is still the given spot with the settle delay", () => {
    expect(src).toMatch(/useRef<[\s\S]{0,200}>\(\{\s*x: at\.x,\s*y: at\.y,\s*since: performance\.now\(\),\s*key: 0,\s*delay: GHOST_SETTLE_MS,\s*\}\);\s*fadeRef\.current = ghostFade\(fadeRef\.current, at, performance\.now\(\)\);/);
  });
});
