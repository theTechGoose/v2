/**
 * REQ-647 (demo-loop cycle 5, issues m29 + m23 + c2-p13-r) — the end of a demo is said on every
 * path, survives a page load, and a restart after it is said long enough to be read.
 *
 *   - m29: the customer's pill vanished with no message when the end was learned any way other
 *     than the socket's `ended` frame (the /active poll answering null, a refused/closed socket, a
 *     carried demo /active denies, a page load). Now every "demo gone" path sets an ended notice
 *     (`goneNotice`), and the tab carries it across a load in REQ-535's slot (`keepEnded` /
 *     `carriedEnded`); a Connected grace is never claimed once /active denied the demo.
 *   - m23: "{name} started a new demo" lasted 4 s; it now lasts ~10 s or until the customer acts
 *     (no sooner than RESTART_MIN_MS) — and an end learned silently still opens the window.
 *   - c2-p13-r: /admin?demo=ended&by=you paints the notice from the server render (the island's
 *     `endedNotice` prop), so it shows on first paint, before (or without) hydration.
 */
import * as fs from "fs";
import * as path from "path";
import {
  carriedDemo,
  carriedEnded,
  keepDemo,
  keepEnded,
  PILL_CARRY_KEY,
  PILL_ENDED_FRESH_MS,
  showsConnected,
} from "../../front-end/lib/demo-mode/pill-carry";
import {
  RESTART_MIN_MS,
  RESTART_SAY_MS,
  restartNotice,
} from "../../shared/demo-mode/restart";
import { goneNotice } from "../../shared/demo-mode/ended";

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
  presenterName: "Alex",
  targetName: "Linda",
  targetUserId: "u-linda",
  presenters: [{ userId: "u-alex", name: "Alex", color: "#2563eb" }],
};

function clock() {
  let now = 100_000;
  const timers: Array<{ fn: () => void; due: number; live: boolean }> = [];
  const states: boolean[] = [];
  const r = restartNotice({
    onChange: (f) => states.push(f),
    now: () => now,
    setTimer: (fn, ms) => {
      const h = { fn, due: now + ms, live: true };
      timers.push(h);
      return h;
    },
    clearTimer: (h) => {
      (h as { live: boolean }).live = false;
    },
  });
  const tick = (ms: number) => {
    now += ms;
    for (const t of timers) {
      if (t.live && t.due <= now) {
        t.live = false;
        t.fn();
      }
    }
  };
  return { r, tick, states, last: () => states[states.length - 1] };
}

describe("REQ-647 (cycle 5, m29) — a demo lost without an `ended` frame is still said", () => {
  test("goneNotice: a demo this side had → 'The demo ended' (by unknown); a notice already up is kept; no demo → nothing", () => {
    expect(goneNotice(true, null)).toEqual({ by: "unknown" });
    expect(goneNotice(true, { by: "other", name: "Alex" })).toEqual({
      by: "other",
      name: "Alex",
    });
    expect(goneNotice(false, null)).toBeNull();
    expect(goneNotice(false, { by: "you" })).toEqual({ by: "you" });
  });

  test("keepEnded / carriedEnded: the notice rides the tab's slot to the next page, and replaces the demo there", () => {
    const s = new MemStore();
    keepDemo(s, demo, true, 1_000);
    keepEnded(s, { by: "other", name: "Alex" }, 2_000);
    expect(carriedDemo(s, 2_100)).toBeNull();
    expect(carriedEnded(s, 2_100)).toEqual({ by: "other", name: "Alex" });
    expect(s.m.has(PILL_CARRY_KEY)).toBe(true);
  });

  test("carriedEnded: stale or malformed → null; a live demo in the slot is not an end", () => {
    const s = new MemStore();
    keepEnded(s, { by: "unknown" }, 1_000);
    expect(carriedEnded(s, 1_000 + PILL_ENDED_FRESH_MS + 1)).toBeNull();
    expect(PILL_ENDED_FRESH_MS).toBeGreaterThanOrEqual(60_000);
    s.setItem(PILL_CARRY_KEY, "{not json");
    expect(carriedEnded(s, 1_000)).toBeNull();
    s.setItem(PILL_CARRY_KEY, JSON.stringify({ ended: { by: "x" }, at: 1 }));
    expect(carriedEnded(s, 2)).toBeNull();
    keepDemo(s, demo, true, 1_000);
    expect(carriedEnded(s, 1_100)).toBeNull();
    // refused storage never throws
    const bad = {
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
      removeItem: () => {},
    };
    expect(() => keepEnded(bad, { by: "you" }, 1)).not.toThrow();
    expect(carriedEnded(bad, 1)).toBeNull();
  });

  test("showsConnected: the carried grace never claims Connected once /active denied the demo", () => {
    expect(showsConnected("connecting", true, null)).toBe(true);
    expect(showsConnected("connecting", true, true)).toBe(true);
    expect(showsConnected("connecting", true, false)).toBe(false);
    expect(showsConnected("relay", false, false)).toBe(true);
  });
});

describe("REQ-647 (cycle 5, m23) — 'started a new demo' stays until read", () => {
  test("it lasts ~10 s (REVISION of REQ-298's 4 s)", () => {
    expect(RESTART_SAY_MS).toBeGreaterThanOrEqual(9_000);
    expect(RESTART_SAY_MS).toBeLessThanOrEqual(12_000);
    expect(RESTART_MIN_MS).toBeGreaterThanOrEqual(1_500);
    expect(RESTART_MIN_MS).toBeLessThan(RESTART_SAY_MS);
  });

  test("the customer's input clears it — not in its first RESTART_MIN_MS; nothing up, input does nothing", () => {
    const h = clock();
    h.r.touched();
    expect(h.states).toEqual([]);
    h.r.ended();
    h.r.started(true);
    expect(h.last()).toBe(true);
    h.tick(RESTART_MIN_MS - 1);
    h.r.touched();
    expect(h.last()).toBe(true);
    h.tick(1);
    h.r.touched();
    expect(h.last()).toBe(false);
    h.tick(RESTART_SAY_MS);
    expect(h.states).toEqual([true, false]);
  });

  test("left alone it goes after RESTART_SAY_MS", () => {
    const h = clock();
    h.r.ended();
    h.r.started(false);
    h.tick(RESTART_SAY_MS - 1);
    expect(h.last()).toBe(true);
    h.tick(1);
    expect(h.last()).toBe(false);
  });
});

describe("REQ-647 — the overlay is wired to it", () => {
  const src = read("front-end/islands/DemoModeOverlay.tsx");
  const app = read("front-end/routes/_app.tsx");

  test("the poll's 'no demo' and the closed socket go through demoGone, never a bare setDemo(null)", () => {
    const poll = src.slice(src.indexOf("const poller = activePoll("));
    const pollAsk = poll.slice(0, poll.indexOf("setOpening(null);"));
    expect(pollAsk).toMatch(/demoGone\(\)/);
    expect(pollAsk).not.toMatch(/setDemo\(null\)/);
    const closed = src.slice(src.indexOf('if (s === "closed")'));
    const closedBody = closed.slice(0, closed.indexOf("onPeerOnline"));
    expect(closedBody).toMatch(/demoGone\(\)/);
    expect(closedBody).not.toMatch(/setDemo\(null\)/);
    // demoGone sets the notice and opens REQ-298's window
    const fn = src.slice(src.indexOf("function demoGone("));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/goneNotice\(/);
    expect(body).toMatch(/restartRef\.current\?\.ended\(\)/);
  });

  test("the end is carried (keepEnded) and seeded on the next page (carriedEnded); `ended` receipt is logged", () => {
    expect(src).toMatch(/keepEnded\(sessionStore\(\)/);
    expect(src).toMatch(/carriedEnded\(sessionStore\(\)/);
    const onEnded = src.slice(src.indexOf("onEnded: (by, reason, pid) =>"));
    expect(onEnded.slice(0, 400)).toMatch(/console\.info\(/);
  });

  test("c2-p13-r: _app hands /admin's ended notice to the island, which paints it from its first render", () => {
    expect(app).toMatch(/<DemoModeOverlay[^>]*endedNotice=/);
    expect(src).toMatch(
      /useState<EndedNotice \| null>\(\s*\(\) =>\s*props\.endedNotice/,
    );
  });
});
