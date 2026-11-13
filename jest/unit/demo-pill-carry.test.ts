/**
 * REQ-535 — demo-loop cycle 4, issue m13: the customer's pill disappeared, then said
 * "Connecting…" for 2-4 s after EVERY page load (the app has no client-side navigation: each link
 * is a full load and the overlay mounted fresh with no demo). The tab now keeps its demo and
 * whether its page was connected (sessionStorage, pill-carry.ts); the next page seeds the pill
 * from it at once and keeps the Connected face for a ~5 s grace while its own link comes up.
 */
import * as fs from "fs";
import * as path from "path";
import {
  carriedDemo,
  forgetDemo,
  keepDemo,
  PILL_CARRY_FRESH_MS,
  PILL_CARRY_GRACE_MS,
  PILL_CARRY_KEY,
  showsConnected,
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

describe("REQ-535 (demo-loop cycle 4, m13) — the customer's pill survives a page load", () => {
  test("a connected page's demo is carried to the next page of the tab", () => {
    const s = new MemStore();
    keepDemo(s, demo, true, 1_000);
    expect(carriedDemo(s, 1_400)).toEqual({ demo, connected: true });
  });

  test("a page that was still connecting carries the demo but not the Connected face", () => {
    const s = new MemStore();
    keepDemo(s, demo, false, 1_000);
    expect(carriedDemo(s, 1_400)).toEqual({ demo, connected: false });
  });

  test("a page that went long ago carries nothing (no ghost pill on a tab reopened later)", () => {
    const s = new MemStore();
    keepDemo(s, demo, true, 1_000);
    expect(carriedDemo(s, 1_000 + PILL_CARRY_FRESH_MS + 1)).toBeNull();
  });

  test("forgetDemo clears it; garbage, a missing store and a refusing store carry nothing", () => {
    const s = new MemStore();
    keepDemo(s, demo, true, 1_000);
    forgetDemo(s);
    expect(carriedDemo(s, 1_100)).toBeNull();
    s.setItem(PILL_CARRY_KEY, "{not json");
    expect(carriedDemo(s, 1_100)).toBeNull();
    s.setItem(
      PILL_CARRY_KEY,
      JSON.stringify({ demo: { id: 1 }, connected: true, at: 1_000 }),
    );
    expect(carriedDemo(s, 1_100)).toBeNull();
    expect(carriedDemo(null, 1_100)).toBeNull();
    const refusing = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => keepDemo(refusing, demo, true, 1)).not.toThrow();
    expect(() => forgetDemo(refusing)).not.toThrow();
    expect(carriedDemo(refusing, 1)).toBeNull();
  });

  test("the face: Connected while the link is up, or while a carried grace runs; never after the end", () => {
    expect(showsConnected("direct", false)).toBe(true);
    expect(showsConnected("relay", false)).toBe(true);
    expect(showsConnected("connecting", false)).toBe(false);
    expect(showsConnected("waiting", false)).toBe(false);
    expect(showsConnected("connecting", true)).toBe(true);
    expect(showsConnected("waiting", true)).toBe(true);
    expect(showsConnected("between", true)).toBe(true);
    expect(showsConnected("ended", true)).toBe(false);
    expect(showsConnected("closed", true)).toBe(false);
    expect(showsConnected("replaced", true)).toBe(false);
  });

  test("the grace is about 5 s", () => {
    expect(PILL_CARRY_GRACE_MS).toBeGreaterThanOrEqual(3_000);
    expect(PILL_CARRY_GRACE_MS).toBeLessThanOrEqual(6_000);
  });

  describe("the overlay is wired to it", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    test("it seeds the demo from the tab's carried one on mount (before /active answers)", () => {
      expect(src).toMatch(/carriedDemo\(\s*sessionStore\(\)/);
      expect(src).toMatch(/setDemo\(\s*carried\.demo\s*\)/);
    });
    test("the status label and the stage's face go through showsConnected with the grace", () => {
      // REQ-647 (cycle 5, m29): and what /active last said of the demo
      expect(src).toMatch(
        /showsConnected\(\s*status\s*,\s*carrying\s*,\s*activeOk\s*\)/,
      );
      expect(src).toMatch(/PILL_CARRY_GRACE_MS/);
    });
    test("the page keeps its demo and link state as it goes, and forgets it when the demo is gone", () => {
      expect(src).toMatch(/keepDemo\(/);
      expect(src).toMatch(/forgetDemo\(/);
      expect(src).toMatch(/"pagehide"/);
    });
  });
});
