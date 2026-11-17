/**
 * Demo-loop run 16 (2026-11-17), by hand — Raphael: "fix the polish problems personally, until
 * there are none."
 *  m1+m2 — REQ-890 AMENDMENT 5: at 390 px the tab's peek opened AWAY from the resting pointer —
 *       the left-docked one under it, then (the next placement, the row crowded) at the top of
 *       the screen, held open by the pointer on the tab's box; the right-docked one a row above
 *       the mouse — so the click meant for "Demo" landed on the page. A peek opens under the
 *       pointer that opens it (among the tab's row's boxes, one that covers the pointer), and a
 *       peek the pointer is on keeps its box.
 *  m4 — REQ-820 AMENDMENT 5: Keep going shrank the asking pill (671 px) to the peek (444 px),
 *       which GLIDED 226 px to its box: place() had recorded no size for the asking form, so the
 *       shrink looked like the same size. The asking form's size is recorded; the shrink jumps.
 *  p4+p5 — REQ-890 AMENDMENT 6: the tab's click guard follows the approach that opened the peek
 *       (continuous moves inside the tab's box) and Keep going (End back under the still mouse).
 *  p2 — REQ-864 AMENDMENT: /admin's grant button read "…" while Demo said "Opening…" — one
 *       busy id for three actions. The busy row knows which action is pending.
 *  p3 — REQ-868 AMENDMENT: the stage kept drawing the customer's folded pill under "The demo
 *       ended". An ended stage drops the pill ghost too.
 *  m3 — REQ-827 AMENDMENT: a native confirm()/alert() on the customer's screen was invisible on
 *       the stage ("Live", nothing). The overlay says it on the wire; the stage shows its words
 *       in the chrome row.
 */
import * as fs from "fs";
import * as path from "path";
import {
  approachMoved,
  hoverClickIsTab,
  PEEK_APPROACH_GAP_MS,
  PEEK_HOVER_CLICK_PX,
  peekBox,
  peekStays,
  PILL_MARGIN,
  PILL_TAB,
} from "../../shared/demo-mode/pill";
import { parsePeerMessage } from "../../shared/demo-mode/protocol";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const overlay = read("front-end/islands/DemoModeOverlay.tsx");
const stage = read("front-end/islands/DemoStage.tsx");
const admin = read("front-end/islands/AdminPage.tsx");
const en = JSON.parse(read("lang/en.json"));
const es = JSON.parse(read("lang/es.json"));

/** a 390×844 view, the whole pill 246×43 at its home, the compact 180×43 */
const view = { w: 390, h: 844 };
const home = { left: 12, top: 789, width: 246, height: 43 };
const rightTab = { left: 294, top: 364, width: PILL_TAB.w, height: PILL_TAB.h };
const leftTab = { left: 0, top: 564, width: PILL_TAB.w, height: PILL_TAB.h };
const inside = (r: { left: number; top: number; width: number; height: number }, p: { x: number; y: number }) =>
  p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height;

describe("REQ-890 AMENDMENT 5 (demo-loop run 16, m1 + m2): a peek opens under the pointer that opens it", () => {
  test("the tab's row crowded with words: without a pointer the peek goes to a clear row above (AMENDMENT 3)", () => {
    const words = (r: { top: number }) => (Math.round(r.top + 43) === rightTab.top + rightTab.height ? 3 : 0);
    const b = peekBox({ home, view, tab: rightTab, texts: words });
    expect(b.top + b.height).toBeLessThan(rightTab.top);
  });
  test("with the pointer on the tab (m2: (314,380)), the peek covers it on the tab's row, words or not", () => {
    const words = (r: { top: number }) => (Math.round(r.top + 43) === rightTab.top + rightTab.height ? 3 : 0);
    const point = { x: 314, y: 380 };
    const b = peekBox({ home, view, tab: rightTab, texts: words, point });
    expect(inside(b, point)).toBe(true);
    expect(Math.round(b.top + b.height)).toBe(rightTab.top + rightTab.height);
  });
  test("among the boxes covering the pointer, the clearest one (controls, then words)", () => {
    // a control under every box whose left edge is below 100: the covering box further right wins
    const controls = (r: { left: number }) => (r.left < 100 ? 1 : 0);
    const point = { x: 320, y: 380 };
    const b = peekBox({ home, view, tab: rightTab, controls, point });
    expect(inside(b, point)).toBe(true);
    expect(b.left).toBeGreaterThanOrEqual(100);
  });
  test("the compact form covers the pointer when the whole cannot clear the row (REQ-890's order kept)", () => {
    const words = (r: { width: number }) => (r.width > 200 ? 2 : 0);
    const point = { x: 314, y: 380 };
    const b = peekBox({ home, view, tab: rightTab, texts: words, compact: { w: 180, h: 43 }, point });
    expect(inside(b, point)).toBe(true);
    expect(b.compact).toBe(true);
  });
  test("a pointer no row box can cover (the tab's outer part, in the margin's gap): the usual search", () => {
    const point = { x: 388, y: 380 }; // the right margin: no box reaches x 388
    const b = peekBox({ home, view, tab: rightTab, point });
    expect(b.left + b.width).toBe(view.w - PILL_MARGIN);
    expect(Math.round(b.top + b.height)).toBe(rightTab.top + rightTab.height);
  });
  test("a pointer never seen (NaN) is no pointer", () => {
    const point = { x: NaN, y: NaN };
    const words = (r: { top: number }) => (Math.round(r.top + 43) === rightTab.top + rightTab.height ? 3 : 0);
    const b = peekBox({ home, view, tab: rightTab, texts: words, point });
    expect(b.top + b.height).toBeLessThan(rightTab.top);
  });
  test("the left-docked tab (m1): the peek flush under the pointer at (15,580) covers it", () => {
    const words = (r: { top: number }) => (Math.round(r.top + 43) === leftTab.top + leftTab.height ? 3 : 0);
    const point = { x: 15, y: 580 };
    const b = peekBox({ home, view, tab: leftTab, texts: words, point });
    expect(inside(b, point)).toBe(true);
  });
});

describe("REQ-890 AMENDMENT 5 (run 16, m1): a peek the pointer is on keeps its box", () => {
  const last = { left: 12, top: 553, width: 246, height: 43 };
  test("the pointer on the last box, the same size, in view: it stays", () => {
    expect(peekStays({ last, size: { w: 246, h: 43 }, point: { x: 15, y: 580 }, view })).toBe(true);
  });
  test("the pointer off it: placed again", () => {
    expect(peekStays({ last, size: { w: 246, h: 43 }, point: { x: 300, y: 300 }, view })).toBe(false);
  });
  test("no last box, another size (the compact form now), a pointer never seen, or a box out of the window: placed again", () => {
    const p = { x: 15, y: 580 };
    expect(peekStays({ last: null, size: { w: 246, h: 43 }, point: p, view })).toBe(false);
    expect(peekStays({ last, size: { w: 180, h: 43 }, point: p, view })).toBe(false);
    expect(peekStays({ last, size: { w: 246, h: 43 }, point: { x: NaN, y: NaN }, view })).toBe(false);
    expect(peekStays({ last, size: { w: 246, h: 43 }, point: p, view: { w: 200, h: 844 } })).toBe(false);
  });
  test("wiring: the peek's placement passes the pointer, keeps the box the pointer is on, and forgets it when the peek folds", () => {
    expect(overlay).toMatch(/const peekBoxRef = useRef<Rect \| null>\(null\);/);
    expect(overlay).toMatch(
      /peekStays\(\{\s*last: peekBoxRef\.current,\s*size: \{ w: peekHome\.width, h: peekHome\.height \},\s*point: pointRef\.current,\s*view,?\s*\}\)/,
    );
    expect(overlay).toMatch(/peekBox\(\{[\s\S]{0,900}?point: pointRef\.current,/);
    expect(overlay).toMatch(/peekBoxRef\.current = p\.tucked \? box : null;/);
    expect(overlay).toMatch(/if \(!peek\) \{[\s\S]{0,200}?peekBoxRef\.current = null;/);
    // the tab's hover update is where the pointer is first seen
    expect(overlay).toMatch(/onMouseMove=\{\(e\) => \{[\s\S]{0,400}?pointRef\.current = \{ x: e\.clientX, y: e\.clientY \};/);
  });
});

describe("REQ-820 AMENDMENT 5 (run 16, m4): the asking form's size is recorded, so Keep going's shrink jumps", () => {
  test("wiring: place()'s early return while End asks records the asking form's size", () => {
    expect(overlay).toMatch(
      /if \(el\.querySelector\('\[data-cy="demo-end-ask"\]'\)\) \{\s*(?:\/\/[^\n]*\n\s*)*sizedRef\.current = \{\s*w: Math\.ceil\(el\.getBoundingClientRect\(\)\.width\),\s*h: el\.offsetHeight,?\s*\};\s*(?:\/\/[^\n]*\n\s*)*clampAsk\(\);\s*sendPill\(\);\s*return;/,
    );
  });
});

describe("REQ-890 AMENDMENT 6 (run 16, p4 + p5): the tab's click guard follows the approach, and Keep going", () => {
  const tab = { left: 294, top: 684, width: 96, height: 32 };
  const start = { at: { x: 297, y: 686 }, moved: 1000, tab };
  test("a continuous move inside the tab's box carries the point with it (the approach goes on)", () => {
    const a = approachMoved(start, { x: 309, y: 700 }, 1000 + PEEK_APPROACH_GAP_MS - 1);
    expect(a).toEqual({ at: { x: 309, y: 700 }, moved: 1000 + PEEK_APPROACH_GAP_MS - 1, tab });
    expect(hoverClickIsTab(a!.at, { x: 309, y: 700 })).toBe(true);
  });
  test("a move after a rest, further than PEEK_HOVER_CLICK_PX: a deliberate move — End is End", () => {
    expect(approachMoved(start, { x: 320, y: 700 }, 1000 + PEEK_APPROACH_GAP_MS)).toBeNull();
  });
  test("a move after a rest within PEEK_HOVER_CLICK_PX: a tremor, the guard stays", () => {
    const a = approachMoved(start, { x: 297 + PEEK_HOVER_CLICK_PX - 1, y: 686 }, 5000);
    expect(a).toEqual(start);
  });
  test("a continuous move that leaves the tab's box: the approach ended", () => {
    expect(approachMoved(start, { x: 200, y: 686 }, 1100)).toBeNull();
  });
  test("no approach: nothing", () => {
    expect(approachMoved(null, { x: 1, y: 1 }, 1)).toBeNull();
  });
  test("wiring: the tab's hover starts the approach, moves carry it, End's guard reads its point, Keep going starts one where the mouse rests", () => {
    expect(overlay).not.toMatch(/hoverOpenAtRef/);
    expect(overlay).toMatch(/const approachRef = useRef<Approach \| null>\(null\);/);
    expect(overlay).toMatch(
      /onMouseMove=\{\(e\) => \{[\s\S]{0,500}?approachRef\.current = \{\s*at: \{ x: e\.clientX, y: e\.clientY \},\s*moved: Date\.now\(\),\s*tab: pillRef\.current\.getBoundingClientRect\(\),?\s*\};/,
    );
    expect(overlay).toMatch(/approachRef\.current = approachMoved\(\s*approachRef\.current,\s*pointRef\.current,\s*Date\.now\(\),?\s*\);/);
    expect(overlay).toMatch(
      /const endGuard = \(e: MouseEvent\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(\s*!hoverClickIsTab\(approachRef\.current\?\.at \?\? null, \{ x: e\.clientX, y: e\.clientY \}\)\s*\) \{?\s*return false;/,
    );
    // REQ-890 AMENDMENT 6 (p4) — the ask withdrawn (Keep going): a click where the mouse rests is not End's
    expect(overlay).toMatch(
      /if \(wasAsking && !asking && pillRef\.current\) \{\s*(?:\/\/[^\n]*\n\s*)*approachRef\.current = \{\s*at: pointRef\.current,\s*moved: 0,\s*tab: pillRef\.current\.getBoundingClientRect\(\),?\s*\};/,
    );
  });
});

describe("REQ-864 AMENDMENT (run 16, p2): /admin's busy row knows which action is pending", () => {
  test("one busy state carrying the action; the grant/revoke button says … only for its own action", () => {
    expect(admin).not.toMatch(/busyId/);
    expect(admin).toMatch(/const \[busy, setBusy\] = useState<\{ id: string; kind: RowAction \} \| null>\(\s*null,?\s*\);/);
    expect(admin).toMatch(/\{busy\?\.id === u\.id && busy\.kind === "grant"\s*\?\s*"…"/);
  });
  test("Demo says Opening… (and waits) only for its own action", () => {
    expect(admin).toMatch(/\(busy\?\.id === u\.id && busy\.kind === "demo"\s*\?\s*";opacity:\.65;cursor:wait"/);
    expect(admin).toMatch(/\{busy\?\.id === u\.id && busy\.kind === "demo"\s*\?\s*t\("adminPage\.opening"\)/);
    expect(admin).toMatch(/setBusy: \(id\) => setBusy\(id \? \{ id, kind: "demo" \} : null\),/);
  });
  test("every action names itself", () => {
    expect(admin).toMatch(/async function toggleSuper\(u: AdminUserView\) \{\s*setBusy\(\{ id: u\.id, kind: "grant" \}\);/);
    expect(admin).toMatch(/async function setFeature\([^)]*\) \{\s*setBusy\(\{ id: u\.id, kind: "feature" \}\);/);
    expect(admin).toMatch(/async function impersonate\(id: string\) \{\s*if \(!id\) return;\s*setBusy\(\{ id, kind: "impersonate" \}\);/);
    expect(admin).toMatch(/const frozen = busy !== null \|\| lock !== null;/);
  });
});

describe("REQ-868 AMENDMENT (run 16, p3): an ended stage drops the pill ghost too", () => {
  test("wiring: the ghost is not shown while the stage says the demo ended", () => {
    expect(stage).toMatch(/const pillShown = ended \|\| look\.elsewhere \|\| signedOut \|\|/);
  });
});

describe("REQ-827 AMENDMENT (run 16, m3): a native confirm()/alert() on the customer's screen is said on the stage", () => {
  test("the wire carries the dialog's words, and its closing", () => {
    expect(parsePeerMessage({ k: "dialog", text: "¿Eliminar esta cotización?" })).toEqual({
      k: "dialog",
      text: "¿Eliminar esta cotización?",
    });
    expect(parsePeerMessage({ k: "dialog", text: null })).toEqual({ k: "dialog", text: null });
    expect(parsePeerMessage({ k: "dialog" })).toBeNull();
    expect(parsePeerMessage({ k: "dialog", text: 7 })).toBeNull();
    // junk is cut, never trusted whole
    const long = parsePeerMessage({ k: "dialog", text: "x".repeat(2000) }) as { text: string };
    expect(long.text.length).toBe(400);
  });
  test("wiring: the customer's overlay wraps confirm and alert while it is the customer, says the words before the question blocks, and puts them back", () => {
    expect(overlay).toMatch(/const native = \{ confirm: globalThis\.confirm, alert: globalThis\.alert \};/);
    expect(overlay).toMatch(/globalThis\.confirm = \(text\?: string\) => \{\s*(?:\/\/[^\n]*\n\s*)*say\(String\(text \?\? ""\)\);\s*try \{\s*return native\.confirm\.call\(globalThis, text\);\s*\} finally \{\s*say\(null\);\s*\}\s*\};/);
    expect(overlay).toMatch(/globalThis\.alert = \(text\?: unknown\) => \{\s*(?:\/\/[^\n]*\n\s*)*say\(String\(text \?\? ""\)\);\s*try \{\s*native\.alert\.call\(globalThis, text\);\s*\} finally \{\s*say\(null\);\s*\}\s*\};/);
    expect(overlay).toMatch(/linkRef\.current\?\.send\(\{ k: "dialog", text \}\)/);
    expect(overlay).toMatch(/globalThis\.confirm = native\.confirm;\s*globalThis\.alert = native\.alert;/);
  });
  test("wiring: the stage keeps the words, shows them in the chrome row, and drops them when the dialog closes, the page leaves or the demo ends", () => {
    expect(stage).toMatch(/const \[nativeAsk, setNativeAsk\] = useState<string \| null>\(null\);/);
    expect(stage).toMatch(/case "dialog":\s*(?:\/\/[^\n]*\n\s*)*setNativeAsk\(m\.text\);\s*break;/);
    expect(stage).toMatch(/case "leave":\s*customerRef\.current = null;\s*glide\.hide\(\);\s*setNativeAsk\(null\);/);
    expect(stage).toMatch(/onEnded: \(by, reason, pid\) => \{[\s\S]{0,400}?setNativeAsk\(null\);/);
    expect(stage).toMatch(/\{badges && nativeAsk !== null && tabNote === null && \(\s*<div\s*data-cy="demo-native-dialog"/);
    expect(stage).toMatch(/t\("demoMode\.nativeDialog", \{ text: nativeAsk \}\)/);
    // the picker chip yields the row to it (a blocked page is the more important news)
    expect(stage).toMatch(/\{badges && pickerOut !== null && tabNote === null && nativeAsk === null && \(/);
    expect(stage).toMatch(/\{badges && off && pickerOut === null && tabNote === null && nativeAsk === null && \(/);
  });
  test("the words exist in both languages and carry the text", () => {
    expect(en["demoMode.nativeDialog"]).toMatch(/\{text\}/);
    expect(es["demoMode.nativeDialog"]).toMatch(/\{text\}/);
    expect(es["demoMode.nativeDialog"]).toMatch(/navegador/);
  });
});
