/**
 * Demo-loop run 18 (2026-11-17), by hand — the customer's End answers, the presenter's /admin
 * after End, and the stage's word for a tab switch.
 *  m1 — REQ-235 AMENDMENT: the folded tab's × asked and the FIRST click on "Sí, terminar" (820 px
 *       away, ~400 ms later) did nothing: Yes waits END_ARM_MS for a double click's second click,
 *       which lands where the first did. A Yes the press that asked is not on arms at once.
 *  m2 — REQ-890 AMENDMENT 6 REVISION 2: the peek opened under the approaching mouse with End under
 *       it; a full second's rest and the click was still "the tab's". An approach is over once
 *       the pointer has rested PEEK_APPROACH_REST_MS: End under it is End's.
 *  p2 — REQ-908 AMENDMENT: /admin after End painted the generic rail (no Admin, no name) for
 *       ~350 ms — the dash cache cleared with the impersonation, the sidebar waiting for /me.
 *       /admin seeds the sidebar from the session it rendered for.
 *  p3 — REQ-648 AMENDMENT: "Loading their next page…" for a switch to a tab already open; the
 *       stage says "Catching up…" then (nothing of theirs is loading).
 */
import * as fs from "fs";
import * as path from "path";
import {
  type Approach,
  approachClaims,
  approachMoved,
  approachRested,
  PEEK_APPROACH_GAP_MS,
  PEEK_APPROACH_REST_MS,
  PEEK_HOVER_CLICK_PX,
} from "../../shared/demo-mode/pill.ts";
import {
  END_ARM_MS,
  END_PRESS_NEAR_PX,
  type EndAsk,
  endConfirm,
  yesArmsAtOnce,
} from "../../shared/demo-mode/ended.ts";
import { stageStatus } from "../../shared/demo-mode/stage-frame.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const overlay = read("front-end/islands/DemoModeOverlay.tsx");
const stage = read("front-end/islands/DemoStage.tsx");
const endDemo = read("front-end/components/demo-mode/EndDemo.tsx");
const sidebar = read("front-end/islands/DashSidebar.tsx");
const adminRoute = read("front-end/routes/admin/index.tsx");

describe("REQ-235 AMENDMENT (run 18, m1): Yes counts at once when the press that asked is not on it", () => {
  const yes = { left: 900, top: 560, width: 90, height: 28 };
  test("a press far from Yes (the folded tab's ×, 820 px away) arms at once", () => {
    expect(yesArmsAtOnce({ x: 82, y: 576 }, yes)).toBe(true);
    expect(yesArmsAtOnce({ x: 945, y: 700 }, yes)).toBe(true);
  });
  test("a press on Yes, or within END_PRESS_NEAR_PX of it (a double click's spread), keeps the clock", () => {
    expect(END_PRESS_NEAR_PX).toBe(12);
    expect(yesArmsAtOnce({ x: 945, y: 574 }, yes)).toBe(false);
    expect(yesArmsAtOnce({ x: 900 - 11, y: 560 - 11 }, yes)).toBe(false);
    expect(yesArmsAtOnce({ x: 990 + 12, y: 574 }, yes)).toBe(false);
    expect(yesArmsAtOnce({ x: 990 + 13, y: 574 }, yes)).toBe(true);
  });
  test("no press known (the keyboard, a stale one) or Yes not laid out: the clock as before", () => {
    expect(yesArmsAtOnce(null, yes)).toBe(false);
    expect(yesArmsAtOnce(undefined, yes)).toBe(false);
    expect(yesArmsAtOnce({ x: 0, y: 0 }, null)).toBe(false);
    expect(yesArmsAtOnce({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 0 })).toBe(false);
  });
  test("endConfirm.arm(): asked and unarmed → armed now, its clock dropped; Yes then ends", () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const cleared: unknown[] = [];
    const seen: EndAsk[] = [];
    let ended = 0;
    const c = endConfirm({
      onChange: (s) => seen.push(s),
      onEnd: () => ended++,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: (h) => cleared.push(h),
    });
    c.arm(); // not asking: nothing
    expect(seen).toEqual([]);
    c.ask();
    expect(seen[seen.length - 1]).toEqual({ asking: true, armed: false });
    expect(timers.map((t) => t.ms)).toEqual([END_ARM_MS]);
    c.confirm(); // a double click's second click: not armed, nothing
    expect(ended).toBe(0);
    c.arm();
    expect(seen[seen.length - 1]).toEqual({ asking: true, armed: true });
    expect(cleared).toEqual([1]);
    const n = seen.length;
    c.arm(); // armed already: nothing
    expect(seen.length).toBe(n);
    c.confirm();
    expect(ended).toBe(1);
    expect(seen[seen.length - 1]).toEqual({ asking: false, armed: false });
  });
  test("EndDemo: Yes is measured in the layout pass after the question comes up; End's own press and the host's (the tab's ×) are known", () => {
    expect(endDemo).toMatch(/yesArmsAtOnce,?\s*\} from "\.\.\/\.\.\/\.\.\/shared\/demo-mode\/ended\.ts";/);
    expect(endDemo).toMatch(/pressedAt\?: \(\) => \{ x: number; y: number \} \| null;/);
    expect(endDemo).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(!s\.asking \|\| s\.armed\) return;\s*const press = pressRef\.current \?\? pressedAt\?\.\(\) \?\? null;\s*const yes = yesRef\.current\?\.getBoundingClientRect\(\) \?\? null;\s*if \(yesArmsAtOnce\(press, yes\)\) ask\.arm\(\);\s*\}, \[s\.asking, s\.armed\]\);/,
    );
    expect(endDemo).toMatch(/pressRef\.current = e\.detail > 0\s*\?\s*\{ x: e\.clientX, y: e\.clientY \}\s*:\s*null;\s*ask\.ask\(\);/);
    expect(endDemo).toMatch(/<button\s*ref=\{yesRef\}\s*type="button"\s*data-cy="demo-end-confirm"/);
  });
  test("the customer's pill hands EndDemo where its × was pressed (REQ-876's press, fresh)", () => {
    expect(overlay).toMatch(
      /const pressedAt = \(\) => \{\s*const p = endPressRef\.current;\s*return p && Date\.now\(\) - p\.at < 5000 \? \{ x: p\.x, y: p\.y \} : null;\s*\};/,
    );
    expect(overlay).toMatch(/<EndDemo\s*onEnd=\{end\}\s*guard=\{endGuard\}\s*pressedAt=\{pressedAt\}/);
  });
});

describe("REQ-890 AMENDMENT 6 REVISION 2 (run 18, m2): an approach is over once the pointer has rested a second", () => {
  const tab = { left: 928, top: 648, width: 96, height: 32 };
  const a: Approach = { at: { x: 958, y: 659 }, moved: 10_000, since: 10_000, tab };
  test("PEEK_APPROACH_REST_MS is a full second", () => {
    expect(PEEK_APPROACH_REST_MS).toBe(1000);
  });
  test("approachRested counts from `since`", () => {
    expect(approachRested(a, 10_999)).toBe(false);
    expect(approachRested(a, 11_000)).toBe(true);
    expect(approachRested(a, 10_500, 400)).toBe(true);
  });
  test("approachClaims: a fresh approach claims a click where it ended; rested, far, or none: End is End", () => {
    expect(approachClaims(a, { x: 960, y: 660 }, 10_300)).toBe(true);
    expect(approachClaims(a, { x: 960, y: 660 }, 11_000)).toBe(false);
    expect(approachClaims(a, { x: 958 + PEEK_HOVER_CLICK_PX, y: 659 }, 10_300)).toBe(false);
    expect(approachClaims(null, { x: 958, y: 659 }, 10_300)).toBe(false);
  });
  test("approachMoved: a continuous move restarts the rest; a tremor after a rest keeps it", () => {
    const moved = approachMoved(a, { x: 962, y: 661 }, 10_000 + PEEK_APPROACH_GAP_MS - 1);
    expect(moved).toEqual({ at: { x: 962, y: 661 }, moved: 10_299, since: 10_299, tab });
    const tremor = approachMoved(a, { x: 961, y: 660 }, 12_000);
    expect(tremor).toBe(a);
    expect(tremor!.since).toBe(10_000);
  });
  test("the pill's guards judge by approachClaims, and every approach carries since", () => {
    expect(overlay).not.toMatch(/hoverClickIsTab\(approachRef/);
    expect(overlay).toMatch(
      /const endGuard = \(e: MouseEvent\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(\s*!approachClaims\(\s*approachRef\.current,\s*\{ x: e\.clientX, y: e\.clientY \},\s*Date\.now\(\),?\s*\)\s*\) return false;/,
    );
    expect(overlay).toMatch(
      /const tabClick = \(e: MouseEvent\) => \{\s*const el = pillRef\.current;\s*if \(\s*!el \|\|\s*!approachClaims\(\s*approachRef\.current,\s*\{ x: e\.clientX, y: e\.clientY \},\s*Date\.now\(\),?\s*\)\s*\) return;/,
    );
    expect(overlay).toMatch(/at: pointRef\.current,\s*moved: 0,\s*since: Date\.now\(\),/);
    expect(overlay).toMatch(/at: \{ x: e\.clientX, y: e\.clientY \},\s*moved: Date\.now\(\),\s*since: Date\.now\(\),/);
  });
});

describe("REQ-648 AMENDMENT (run 18, p3): a switch to a tab already open is Catching up…, not Loading their next page…", () => {
  const base = {
    ended: false,
    status: "relay" as const,
    mirrored: true,
    awaiting: false,
    resyncing: false,
    behind: 0,
  };
  test("awaiting another of their tabs: catchingUp; awaiting their next page: loadingNext as before", () => {
    expect(stageStatus({ ...base, awaiting: true, switched: true })).toEqual({ key: "catchingUp" });
    expect(stageStatus({ ...base, awaiting: true, switched: true, pageBehind: 2 })).toEqual({ key: "catchingUp" });
    expect(stageStatus({ ...base, awaiting: true })).toEqual({ key: "loadingNext" });
    expect(stageStatus({ ...base, awaiting: true, switched: false, leave: "navigating" })).toEqual({ key: "loadingNext" });
    expect(stageStatus({ ...base, switched: true })).toEqual({ key: "live" });
  });
  test("the stage says which wait it is, and dims the tab they left either way", () => {
    expect(stage).toMatch(/leave: leaveWhy,\s*(?:\/\/[^\n]*\n\s*)*switched: switchedRef\.current,\s*\}\);/);
    expect(stage).toMatch(
      /const loadingNext = live\.key === "loadingNext" \|\|\s*live\.key === "pageGone" \|\|\s*(?:\/\/[^\n]*\n\s*)*\(awaiting && switchedRef\.current\);/,
    );
  });
});

describe("REQ-908 AMENDMENT (run 18, p2): /admin's rail is the session's from the first paint", () => {
  test("the sidebar takes a seed: the super-admin flag and the name stand in while no profile is cached", () => {
    expect(sidebar).toMatch(/export interface SidebarSeed \{\s*superAdmin: boolean;\s*name\?: string \| null;\s*\}/);
    expect(sidebar).toMatch(
      /export function seedSidebar\(s: SbState, seed\?: SidebarSeed\): SbState \{\s*if \(!seed \|\| s\.profile !== null\) return s;\s*return \{ \.\.\.s, superAdmin: seed\.superAdmin \};\s*\}/,
    );
    expect(sidebar).toMatch(/useState<SbState>\(\(\) =>\s*seedSidebar\(projectSidebar\(readCached\(\)\), seed\)\s*\);/);
    expect(sidebar).toMatch(/sidebarIdentity\(\s*s\.profile \?\? seedIdentity\(seed\),/);
    expect(sidebar).toMatch(/\{ active = "home", showNav = true, seed \}: Props/);
  });
  test("/admin seeds it from the session it rendered for", () => {
    expect(adminRoute).toMatch(
      /<DashSidebar\s*active="admin"\s*seed=\{\{\s*superAdmin: user\?\.superAdmin === true,\s*name: user\?\.name \?\? null,\s*\}\}\s*\/>/,
    );
  });
});
