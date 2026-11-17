/**
 * Demo-loop run 19 (2026-11-17), by hand — the stage's off ghost, the question's first frames,
 * and the stage's word for a new tab.
 *  m2 — REQ-877 AMENDMENT: the off marker's ghost blinked ~10 times a second while the presenter
 *       moved beside the frame (a new key per spot remounted it and restarted its fade). It keeps
 *       its key while her marker glides; a new fade only from nowhere or from his arrow.
 *  p2 — REQ-852 AMENDMENT: the question, placed by placeAsk/clampAsk in the asking layout pass,
 *       glided from the peek's spot (Yes off-screen at 1024 px). A moved dock paints at its box.
 *  p1 — REQ-648 AMENDMENT REVISION: "Catching up…" only for a tab followed before (followTabs
 *       `revisit`); a new tab's first load is "Loading their next page…", also through the link's
 *       brief connecting state while her last page is on show.
 */
import * as fs from "fs";
import * as path from "path";
import {
  followTabs,
  ghostNext,
  reportedGhost,
} from "../../shared/demo-mode/presenter-anchor.ts";
import { stageStatus } from "../../shared/demo-mode/stage-frame.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const overlay = read("front-end/islands/DemoModeOverlay.tsx");
const stage = read("front-end/islands/DemoStage.tsx");

describe("REQ-877 AMENDMENT (run 19, m2): the off marker's ghost glides — one key while it moves", () => {
  const off1 = { at: { x: 100, y: 200 }, outside: true, off: { key: "0,200" } };
  const off2 = { at: { x: 100, y: 215 }, outside: true, off: { key: "0,215" } };
  test("a moved off ghost keeps the key it was drawn with (no remount, no new fade)", () => {
    const next = ghostNext(off1, off2);
    expect(next).toEqual({ at: { x: 100, y: 215 }, outside: true, off: { key: "0,200" } });
    expect(next).not.toBe(off1);
  });
  test("the same spot: the same object (no re-render)", () => {
    expect(ghostNext(off1, { ...off1, off: { key: "0,200" } })).toBe(off1);
    expect(ghostNext(off1, { at: { x: 100.2, y: 200.3 }, outside: true, off: { key: "x" } })).toBe(off1);
  });
  test("from nowhere, or from his arrow, the off ghost takes its own key: a new fade", () => {
    expect(ghostNext(null, off2)).toBe(off2);
    const arrow = { at: { x: 300, y: 300 }, outside: false, off: null };
    expect(ghostNext(arrow, off2)).toBe(off2);
    expect(ghostNext(off2, arrow)).toBe(arrow);
  });
  test("his arrow's ghost: unchanged stays, a change (a move, a direction) is the new one", () => {
    const a = { at: { x: 300, y: 300 }, outside: false, dir: { dx: 1 as const, dy: 0 as const } };
    expect(ghostNext(a, { ...a, at: { x: 300.1, y: 300 } })).toBe(a);
    const b = { ...a, at: { x: 320, y: 300 } };
    expect(ghostNext(a, b)).toBe(b);
    const c = { ...a, dir: { dx: 1 as const, dy: 0 as const, hidden: true } };
    expect(ghostNext(a, c)).toBe(c);
  });
  test("reportedGhost: his mouse beside the frame — a report for ANY of his off spots says where her marker is", () => {
    const frame = { left: 100, top: 50, width: 800, height: 600, s: 1 };
    const held = { a: { vx: 0, vy: 0.4, o: 1 as const }, load: "L", at: null, provisional: false };
    const report = (a: { vx: number; vy: number; o?: 1 }) => ({ k: "placed" as const, pid: "p", a, p: { vx: 0, vy: 0.42 } });
    expect(reportedGhost(held, report({ vx: 0, vy: 0.4, o: 1 }), frame)?.off).toBeTruthy();
    expect(reportedGhost(held, report({ vx: 0, vy: 0.35, o: 1 }), frame)?.off).toBeTruthy();
    expect(reportedGhost(held, report({ vx: 0.5, vy: 0.5 }), frame)).toBeNull();
  });
  test("a new off anchor held keeps the off ghost drawn (no clear per move)", () => {
    expect(stage).toMatch(/setGhost\(\(was\) => a\.o === 1 && was\?\.off \? was : null\);/);
  });
  test("the stage draws the next ghost through ghostNext", () => {
    expect(stage).toMatch(/setGhost\(\(was\) => ghostNext\(was, g\)\);/);
    expect(stage).not.toMatch(/was\.off\?\.key === g\.off\?\.key/);
  });
});

describe("REQ-852 AMENDMENT (run 19, p2): the asking placement paints at its box", () => {
  test("the asking layout pass notes the dock before placeAsk/clampAsk and drops the glide when it moved", () => {
    expect(overlay).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(!asking\) return;\s*(?:\/\/[^\n]*\n\s*)*const dockBefore = \{ \.\.\.dockRef\.current \};\s*placeAsk\(\);\s*clampAsk\(\);\s*(?:\/\/[^\n]*\n\s*)*if \(\s*dockRef\.current\.x !== dockBefore\.x \|\| dockRef\.current\.y !== dockBefore\.y\s*\) \{\s*setNoGlide\(true\);\s*\}/,
    );
  });
});

describe("REQ-648 AMENDMENT REVISION (run 19, p1): Catching up… only for a tab followed before", () => {
  test("followTabs.revisit(): a key followed before is a revisit; a new key is not; learn counts; closed forgets", () => {
    const f = followTabs();
    f.follow("c1", "A");
    expect(f.revisit()).toBe(false);
    f.follow("c2", "B");
    expect(f.revisit()).toBe(false);
    f.follow("c3", "A");
    expect(f.revisit()).toBe(true);
    f.follow("c4"); // its key not known yet
    expect(f.revisit()).toBe(false);
    f.learn("c4", "B");
    expect(f.revisit()).toBe(true);
    f.follow("c5");
    f.learn("c5", "C");
    expect(f.revisit()).toBe(false);
    f.closed();
    f.follow("c6", "A");
    expect(f.revisit()).toBe(false);
  });
  const base = {
    ended: false,
    status: "relay" as const,
    mirrored: true,
    awaiting: false,
    resyncing: false,
    behind: 0,
  };
  test("the link opening to a NEW tab's page while her last page is on show: Loading their next page…, never Connecting…", () => {
    expect(stageStatus({ ...base, status: "connecting", awaiting: true })).toEqual({ key: "loadingNext" });
    expect(stageStatus({ ...base, status: "connecting", awaiting: true, pageBehind: 3 })).toEqual({ key: "loadingNext", n: 3 });
    expect(stageStatus({ ...base, status: "connecting", awaiting: true, switched: true })).toEqual({ key: "catchingUp" });
    // nothing on show yet, or nothing awaited: the link's own word
    expect(stageStatus({ ...base, status: "connecting", awaiting: true, mirrored: false })).toEqual({ key: "connecting" });
    expect(stageStatus({ ...base, status: "connecting" })).toEqual({ key: "connecting" });
  });
  test("the stage says Catching up… only when the tab followed now was followed before", () => {
    expect(stage).toMatch(/const \[switching, setSwitching\] = useState\(false\);/);
    expect(stage).toMatch(/switchedRef\.current = true;\s*setSwitching\(tabsRef\.current\.revisit\(\)\);/);
    expect(stage).toMatch(/switched: switching,/);
    // the word holds until that tab's screen is on show: cleared when the wait ends (and with the
    // demo), never by the tab note or a follow that is no switch — those come a beat earlier
    expect(stage).toMatch(/useEffect\(\(\) => \{\s*if \(!awaiting\) setSwitching\(false\);\s*\}, \[awaiting\]\);/);
    expect((stage.match(/setSwitching\(false\);/g) ?? []).length).toBe(2);
    expect(stage).toMatch(/else switchedRef\.current = false;/);
  });
});
