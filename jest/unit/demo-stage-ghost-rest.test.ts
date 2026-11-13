/**
 * REQ-789 — Raphael (hotfix, 2026-11-13): "look at this in demo view — this flickers my cursor
 * and the flicker is in the wrong place."
 *
 * The stage's ghost of the presenter's own arrow (REQ-642: drawn where the CUSTOMER's screen
 * reported it) blinked while he moved: every move `hold()`s a new anchor and clears the ghost at
 * once; the customer's report for that anchor comes back a link's round trip later (the relay:
 * 100–500 ms) and draws the ghost again, apart from his cursor whenever their layout is not the
 * replica's (other fonts, a modal scrolled elsewhere) — then the next move clears it. So the faint
 * arrow flashed on and off beside his cursor, somewhere else on the frame, and the "You" tag on
 * his own marker flashed with it (the tag moves to the ghost while there is one). Reproduced
 * through the relay with 250 ms of latency: the ghost timeline over a slow sweep read
 * `G.........GG.....G....GGGGGGG.......GGGGG....GGGG....` (G = drawn, . = not).
 *
 * Now the ghost is drawn only once he has RESTED: `ghostWait` says how long after his last anchor
 * a report may be drawn (GHOST_REST_MS); a report that comes sooner waits that long (one timer,
 * dropped by the next anchor) and is drawn if it is still the report for the anchor he holds. In
 * motion: his own marker only. At rest: the ghost once, where their screen has it, staying put
 * until he points elsewhere.
 */
import * as fs from "fs";
import * as path from "path";
import {
  GHOST_REST_MS,
  ghostWait,
} from "../../shared/demo-mode/presenter-anchor";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-789 ghostWait: the ghost of his arrow is drawn only once he has rested", () => {
  test("the rest is a pause of the hand (longer than the small stops of a move), not a wait he would notice", () => {
    expect(GHOST_REST_MS).toBeGreaterThanOrEqual(400);
    expect(GHOST_REST_MS).toBeLessThanOrEqual(800);
  });
  test("right after an anchor the report waits the whole rest; part-way, the remainder", () => {
    expect(ghostWait(1000, 1000)).toBe(GHOST_REST_MS);
    expect(ghostWait(1000, 1100)).toBe(GHOST_REST_MS - 100);
    expect(ghostWait(1000, 1000 + GHOST_REST_MS - 1)).toBe(1);
  });
  test("once the rest has passed it is drawn at once; never a negative wait", () => {
    expect(ghostWait(1000, 1000 + GHOST_REST_MS)).toBe(0);
    expect(ghostWait(1000, 9000)).toBe(0);
    expect(ghostWait(0, 0)).toBe(0); // never held: nothing to rest from
  });
  test("a clock that went backwards (a stamp from before) still waits at most the rest", () => {
    expect(ghostWait(5000, 1000)).toBe(GHOST_REST_MS);
  });
});

describe("REQ-789 wiring: the stage defers the ghost to his rest and drops the wait on his next anchor", () => {
  const src = read("front-end/islands/DemoStage.tsx");
  const slice = (marker: string, len: number) => {
    const at = src.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    return src.slice(at, at + len);
  };
  test("hold() stamps when he last pointed and drops a ghost still waiting", () => {
    const body = slice("const hold = (", 1400);
    expect(body).toContain("holdAtRef.current = performance.now()");
    expect(body).toMatch(/clearGhostWait\(\)/);
    expect(body).toContain("setGhost(null)");
  });
  test("drop() (his mouse left, the demo went, another tab) drops the wait too", () => {
    const body = slice("const drop = () =>", 700);
    expect(body).toMatch(/clearGhostWait\(\)/);
  });
  test("showGhost draws a report only after ghostWait, else waits once and looks again", () => {
    const body = slice("const showGhost = () =>", 1200);
    expect(body).toContain("reportedGhost(");
    expect(body).toContain("ghostWait(holdAtRef.current, performance.now())");
    expect(body).toMatch(/ghostWaitRef\.current\s*=\s*setTimeout\(/);
    // a report of nowhere (or a stale one) clears the ghost at once, waiting for nothing
    expect(body.indexOf("if (!g)")).toBeGreaterThan(-1);
    expect(body.indexOf("if (!g)")).toBeLessThan(body.indexOf("ghostWait("));
  });
  test("the ghost fades in rather than popping: a short opacity animation up to GHOST_OPACITY", () => {
    const ghost = read("front-end/components/demo-mode/PointerGhost.tsx");
    expect(ghost).toMatch(
      /@keyframes pmDemoGhostIn\{from\{opacity:0\}to\{opacity:\$\{GHOST_OPACITY\}\}\}/,
    );
    expect(ghost).toMatch(/animation:pmDemoGhostIn \.\d+s/);
  });
  test("the timer is one per stage and is cleared when the stage unmounts", () => {
    expect(src).toMatch(/const ghostWaitRef = useRef</);
    const unmount = src.indexOf(
      "clearGhostWait();\n",
      src.indexOf("return () => {"),
    );
    expect(unmount).toBeGreaterThan(-1);
  });
});
