/**
 * REQ-830 — demo-loop cycle dm2, issue p6 "Customer pill flashes expanded at bottom-left on every
 * page load before folding". Every link is a full load (REQ-535); the tab carried its demo but not
 * where the pill was or whether it was folded, so the first painted frame was the whole pill at
 * home. keepDemo now also keeps the last placement (folded, the mini-pill's spot, the whole pill's
 * dock, its whole size) and carriedDemo hands it back, so the next page seeds it before paint.
 */
import * as fs from "fs";
import * as path from "path";
import {
  carriedDemo,
  keepDemo,
  PILL_CARRY_KEY,
} from "../../front-end/lib/demo-mode/pill-carry";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const demo = {
  id: "demo-1",
  role: "viewer" as const,
  presenterName: "Hans",
  targetName: "Ana Torres",
  targetUserId: "u-ana",
  presenters: [{ userId: "u-hans", name: "Hans", color: "#2563eb" }],
};

const place = {
  tucked: true,
  tabAt: { x: 1172, y: 11 },
  dock: { x: 1060, y: 0 },
  full: { w: 340, h: 43 },
};

describe("REQ-830 (demo-loop dm2, p6) — the pill's placement is carried to the next page", () => {
  test("REQ-830: the last placement round-trips through the tab's store", () => {
    const s = new MemStore();
    keepDemo(s, demo, true, 1_000, place);
    expect(carriedDemo(s, 1_400)).toEqual({ demo, connected: true, place });
  });

  test("REQ-830: a whole (not folded) pill carries tucked false and its dock", () => {
    const s = new MemStore();
    const whole = {
      tucked: false,
      tabAt: { x: 0, y: 0 },
      dock: { x: 0, y: -60 },
    };
    keepDemo(s, demo, false, 1_000, whole);
    expect(carriedDemo(s, 1_400)?.place).toEqual(whole);
  });

  test("REQ-830: no placement kept → none carried (the demo still is)", () => {
    const s = new MemStore();
    keepDemo(s, demo, true, 1_000);
    const c = carriedDemo(s, 1_400);
    expect(c?.demo).toEqual(demo);
    expect(c?.place).toBeUndefined();
  });

  test("REQ-830: a malformed placement is dropped, never seeded (the demo still is)", () => {
    const bad = [
      { tucked: "yes", tabAt: { x: 0, y: 0 }, dock: { x: 0, y: 0 } },
      { tucked: true, tabAt: { x: "1", y: 0 }, dock: { x: 0, y: 0 } },
      { tucked: true, tabAt: { x: 0, y: 0 }, dock: null },
      { tucked: true, tabAt: { x: NaN, y: 0 }, dock: { x: 0, y: 0 } },
      {
        tucked: true,
        tabAt: { x: 0, y: 0 },
        dock: { x: 0, y: 0 },
        full: { w: "a", h: 1 },
      },
      "nope",
    ];
    for (const p of bad) {
      const s = new MemStore();
      s.setItem(
        PILL_CARRY_KEY,
        JSON.stringify({ demo, connected: true, at: 1_000, place: p }),
      );
      const c = carriedDemo(s, 1_400);
      expect(c?.demo).toEqual(demo);
      expect(c?.place).toBeUndefined();
    }
  });

  test("REQ-830: the overlay keeps its placement and seeds tucked/tabAt/dock in the carried layout effect", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    // every keepDemo passes the last placement
    const keeps = src.match(/keepDemo\([^;]*\);/g) ?? [];
    expect(keeps.length).toBeGreaterThanOrEqual(2);
    for (const k of keeps) expect(k).toMatch(/lastPlaceRef\.current/);
    // the carried-demo layout effect seeds the placement before paint
    const seed = src.slice(src.indexOf("const carried = carriedDemo("));
    const block = seed.slice(0, seed.indexOf("}, []);"));
    expect(block).toMatch(/carried\.place/);
    expect(block).toMatch(/setTucked\(/);
    expect(block).toMatch(/setTabAt\(/);
    expect(block).toMatch(/setDock\(/);
  });
});
