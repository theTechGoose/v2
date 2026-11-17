/**
 * Demo-loop run 15 (2026-11-17), by hand — Raphael: "fix the polish problems personally, until
 * there are none."
 *  m1 — REQ-820 AMENDMENT 3: a customer's FIRST join at 390 px painted the whole pill at its home
 *       (over the welcome form's footer) and glided it 156–186 px up to its band (5 of 5 testers;
 *       the restart jumped). The young pill jumps: its first placement, and every placement within
 *       PILL_YOUNG_MS of its coming out whole, is painted where it lands.
 *  m2 — REQ-890 AMENDMENT 4: a pointer resting on the right-edge tab's "Demo" opened the peek
 *       flush with the tab — End under that pointer — and the click meant for "Demo" asked to end
 *       the demo. A click where the pointer opened the peek, before it has moved, is the tab's.
 *  m3 — REQ-789 AMENDMENT 2: a spot that moved mid-fade restarted the fade at once, so the ghost
 *       blinked (0.24 → 0 → 0.2 → 0 → 0.5) at three spots during her smooth scroll. The restarted
 *       fade waits GHOST_SETTLE_MS unseen; a move within that wait starts the wait over.
 *  p1 — REQ-833 AMENDMENT: the compact pill's details line ("Alex · nueva demo", "Alex te está
 *       guiando") sat on the controls' row and WRAPPED to two lines (54 px) while "Conectando…"
 *       was wide, then one (43 px) at "Conectado": an 11 px jump. On the controls' row the line is
 *       cut, never wrapped — one height.
 *  p4 — REQ-820 AMENDMENT 4: a pointer that entered the pill held it for good when the pill moved
 *       away from under it (Keep going shrank the asking pill back to the peek a row away: no
 *       pointerleave comes without a move). The hold needs the pointer still over the pill's box.
 */
import * as fs from "fs";
import * as path from "path";
import {
  GHOST_FADE_MS,
  GHOST_SETTLE_MS,
  ghostFade,
} from "../../shared/demo-mode/presenter-anchor";
import {
  hoverClickIsTab,
  PEEK_HOVER_CLICK_PX,
  PILL_YOUNG_MS,
  pillJumps,
  pointerRests,
} from "../../shared/demo-mode/pill";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const overlay = read("front-end/islands/DemoModeOverlay.tsx");
const endDemo = read("front-end/components/demo-mode/EndDemo.tsx");
const ghost = read("front-end/components/demo-mode/PointerGhost.tsx");

describe("REQ-820 AMENDMENT 3 (demo-loop run 15, m1): the young pill jumps to where it is placed", () => {
  const size = { w: 366, h: 54 };
  test("its first placement (no size known yet) jumps", () => {
    expect(pillJumps({ size, last: null, wholeSince: 1000, now: 1000 })).toBe(true);
  });
  test("a placement within PILL_YOUNG_MS of its coming out whole jumps, the same size or not", () => {
    expect(pillJumps({ size, last: size, wholeSince: 1000, now: 1000 + PILL_YOUNG_MS - 1 })).toBe(true);
  });
  test("after PILL_YOUNG_MS, the same size glides; another size still jumps (AMENDMENT 2)", () => {
    expect(pillJumps({ size, last: size, wholeSince: 1000, now: 1000 + PILL_YOUNG_MS })).toBe(false);
    expect(pillJumps({ size, last: { w: 364, h: 43 }, wholeSince: 1000, now: 9000 })).toBe(true);
  });
  test("no size measured (the tab is on screen): nothing to say", () => {
    expect(pillJumps({ size: null, last: null, wholeSince: 1000, now: 1000 })).toBe(false);
  });
  test("wiring: place() asks pillJumps, stamps the coming-out-whole, and forgets both when the pill goes", () => {
    expect(overlay).toMatch(/const wholeSinceRef = useRef\(0\);/);
    expect(overlay).toMatch(
      /if \(!p\.tucked && \(tuckedRef\.current \|\| sizedRef\.current === null\)\) \{\s*wholeSinceRef\.current = Date\.now\(\);\s*\}/,
    );
    expect(overlay).toMatch(
      /if \(\s*pillJumps\(\{\s*size: sizeNow,\s*last: sizedRef\.current,\s*wholeSince: wholeSinceRef\.current,\s*now: Date\.now\(\),\s*\}\)\s*\) \{\s*setNoGlide\(true\);\s*\}/,
    );
    expect(overlay).toMatch(/sizedRef\.current = null;\s*wholeSinceRef\.current = 0;/);
    expect(overlay).not.toMatch(/__pillLog/);
  });
});

describe("REQ-890 AMENDMENT 4 (demo-loop run 15, m2): a click where the pointer opened the peek is the tab's, never End's", () => {
  test("within PEEK_HOVER_CLICK_PX of the opening point: the tab's click", () => {
    expect(hoverClickIsTab({ x: 334, y: 660 }, { x: 334, y: 660 })).toBe(true);
    expect(hoverClickIsTab({ x: 334, y: 660 }, { x: 334 + PEEK_HOVER_CLICK_PX - 1, y: 660 })).toBe(true);
  });
  test("the pointer moved on since: End's own click", () => {
    expect(hoverClickIsTab({ x: 334, y: 660 }, { x: 334 + PEEK_HOVER_CLICK_PX + 1, y: 660 })).toBe(false);
  });
  test("no hover opened this peek (a tap, the keyboard): End's own click", () => {
    expect(hoverClickIsTab(null, { x: 334, y: 660 })).toBe(false);
  });
  test("wiring: the tab's mousemove notes where it opened the peek; End asks the host first; the note goes with a move or the peek's end", () => {
    // REVISION (demo-loop run 16, by hand): the note is the approach (REQ-890 AMENDMENT 6), kept in
    // approachRef; the tab's mousemove notes the pointer too (AMENDMENT 5)
    expect(overlay).toMatch(/const approachRef = useRef<Approach \| null>\(null\);/);
    expect(overlay).toMatch(
      /onMouseMove=\{\(e\) => \{\s*(?:\/\/[^\n]*\n\s*)*pointRef\.current = \{ x: e\.clientX, y: e\.clientY \};\s*(?:\/\/[^\n]*\n\s*)*if \(!peekRef\.current && pillRef\.current\) \{\s*approachRef\.current = \{\s*at: \{ x: e\.clientX, y: e\.clientY \},[\s\S]{0,200}?\};\s*\}\s*openPeek\(\);\s*\}\}/,
    );
    expect(overlay).toMatch(/guard=\{endGuard\}/);
    expect(overlay).toMatch(
      /const endGuard = \(e: MouseEvent\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(\s*!hoverClickIsTab\(approachRef\.current\?\.at \?\? null, \{ x: e\.clientX, y: e\.clientY \}\)\s*\) return false;\s*approachRef\.current = null;\s*toggleOpen\(\);\s*return true;\s*\};/,
    );
    expect(overlay).toMatch(/if \(!peek\) \{\s*setPeekOpen\(false\);\s*approachRef\.current = null;[^\n]*\s*\}/);
    expect(overlay).toMatch(
      /approachRef\.current = approachMoved\(\s*approachRef\.current,\s*pointRef\.current,\s*Date\.now\(\),?\s*\);/,
    );
    expect(endDemo).toMatch(/guard\?: \(e: MouseEvent\) => boolean;/);
    expect(endDemo).toMatch(
      /onClick=\{\(e\) => \{\s*if \(guard\?\.\(e\)\) return;\s*ask\.ask\(\);\s*\}\}/,
    );
  });
});

describe("REQ-789 AMENDMENT 2 (demo-loop run 15, m3): a fade restarted by a move waits unseen until the spot has settled", () => {
  const start = { x: 357.1, y: 545.9, since: 1000, key: 0, delay: 0 };
  test("a move mid-fade: a new key, the clock reset, and GHOST_SETTLE_MS of delay before the fade", () => {
    const f = ghostFade(start, { x: 357.1, y: 469.3 }, 1083);
    expect(f).toEqual({ x: 357.1, y: 469.3, since: 1083, key: 1, delay: GHOST_SETTLE_MS });
  });
  test("a move during that wait (before fade + delay have run) starts the wait over", () => {
    const f = ghostFade(start, { x: 357.1, y: 469.3 }, 1083);
    const g = ghostFade(f, { x: 357.1, y: 462.4 }, 1083 + GHOST_SETTLE_MS + 10);
    expect(g.key).toBe(2);
    expect(g.since).toBe(1083 + GHOST_SETTLE_MS + 10);
    expect(g.delay).toBe(GHOST_SETTLE_MS);
  });
  test("once the delayed fade has run (delay + fade), a move slides the drawn ghost: same key, no delay", () => {
    const f = ghostFade(start, { x: 357.1, y: 469.3 }, 1083);
    const g = ghostFade(f, { x: 357.1, y: 400 }, 1083 + GHOST_SETTLE_MS + GHOST_FADE_MS + 1);
    expect(g.key).toBe(1);
    expect(g.since).toBe(1083);
    expect([g.x, g.y]).toEqual([357.1, 400]);
  });
  test("a move after the fade has run carries no delay (the drawn ghost slides)", () => {
    const f = ghostFade(start, { x: 357.1, y: 469.3 }, 1000 + GHOST_FADE_MS + 1);
    expect(f.delay).toBe(0);
  });
  test("wiring: PointerGhost delays the fade by the state's delay and holds opacity 0 meanwhile (both); the first fade waits the settle too", () => {
    expect(ghost).toMatch(
      /animation:pmDemoGhostIn \.25s ease-out \$\{fadeRef\.current\.delay \?\? 0\}ms both/,
    );
    expect(ghost).toMatch(
      /since: performance\.now\(\),\s*key: 0,\s*delay: GHOST_SETTLE_MS,\s*\}\);/,
    );
  });
});

describe("REQ-833 AMENDMENT (demo-loop run 15, p1): the compact pill's details line on the controls' row is cut, never wrapped", () => {
  test("wiring: the details span wraps only on its own row (pillWraps), else it is cut", () => {
    expect(overlay).toMatch(
      /compact\s*\?\s*\(wraps \? `flex-basis:100%;\$\{wrap\}` : cut\)\s*:\s*cut/,
    );
    expect(overlay).toMatch(/const wraps = pillWraps\(\{ compact, open: shownOpen, asking \}\);/);
    expect(overlay).not.toMatch(/compact \? `flex-basis:100%;\$\{wrap\}` : cut/);
    // the words inside (the restart line, the guiding line) wrap only on their own row too
    expect(overlay).toMatch(
      /data-cy="demo-restarted"\s*style=\{compact && wraps \? wrap : cut\}/,
    );
    expect(overlay).toMatch(/<span style=\{compact && wraps \? wrap : cut\}>\s*\{guidingText\}/);
    expect(overlay).not.toMatch(/style=\{compact \? wrap : cut\}/);
  });
});

describe("REQ-820 AMENDMENT 4 (demo-loop run 15, p4): a resting pointer holds the pill only while it is still over it", () => {
  const pill = { left: 131, top: 302, width: 246, height: 43 };
  test("entered and still inside (with 4 px of slack): held", () => {
    expect(pointerRests(true, pill, { x: 200, y: 320 })).toBe(true);
    expect(pointerRests(true, pill, { x: 131 - 3, y: 302 + 43 + 3 })).toBe(true);
  });
  test("entered, but the pill moved away from under it: not held", () => {
    expect(pointerRests(true, pill, { x: 342, y: 380 })).toBe(false);
  });
  test("never entered: not held; entered with no point known (NaN): held as before", () => {
    expect(pointerRests(false, pill, { x: 200, y: 320 })).toBe(false);
    expect(pointerRests(true, pill, { x: NaN, y: NaN })).toBe(true);
  });
  test("wiring: the fold timer's `held` asks pointerRests with the pill's box and the last point; entering notes the point", () => {
    expect(overlay).toMatch(
      /held: \(\) =>\s*(?:\/\/[^\n]*\n\s*)*\(!!pillRef\.current &&\s*pointerRests\(\s*overPillRef\.current,\s*pillRef\.current\.getBoundingClientRect\(\),\s*pointRef\.current,\s*\)\) \|\|/,
    );
    expect(overlay).toMatch(
      /onPointerEnter=\{\(e\) => \{\s*if \(e\.pointerType !== "touch"\) \{\s*overPillRef\.current = true;\s*pointRef\.current = \{ x: e\.clientX, y: e\.clientY \};[^\n]*\s*\}\s*\}\}/,
    );
  });
});
