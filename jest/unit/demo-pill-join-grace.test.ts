/**
 * REQ-821 (demo-loop cycle dm1, issue m9) — the customer's pill opened folded on a dense page, so
 * the REQ-153 amendment's "{name} is guiding you" with End was never shown: REQ-545/637/781 fold
 * the pill whenever page content is under every spot, and only a RESTART (REQ-298's `fresh`) kept
 * it whole. A first join now gets the same grace: the whole pill for JOIN_SAY_MS, or until the
 * customer presses or types after RESTART_MIN_MS (REQ-647's rule), then it yields. Once per demo
 * id — a page load that carries the demo in (REQ-535) is not a join.
 */
import * as fs from "fs";
import * as path from "path";
import {
  JOIN_SAY_MS,
  joinGrace,
  RESTART_MIN_MS,
} from "../../shared/demo-mode/restart.ts";

const ROOT = path.resolve(__dirname, "../..");
const overlay = fs.readFileSync(
  path.join(ROOT, "front-end/islands/DemoModeOverlay.tsx"),
  "utf8",
);

function harness() {
  let now = 100_000;
  const timers: Array<{ fn: () => void; due: number; live: boolean }> = [];
  const states: boolean[] = [];
  const g = joinGrace({
    onChange: (j) => states.push(j),
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
  return {
    g,
    tick,
    states,
    last: () => states[states.length - 1],
    live: () => timers.filter((t) => t.live).length,
  };
}

describe("REQ-821 a first join shows the whole pill before it yields", () => {
  test("the grace is a few seconds: longer than RESTART_MIN_MS, shorter than a restart's line", () => {
    expect(JOIN_SAY_MS).toBeGreaterThan(RESTART_MIN_MS);
    expect(JOIN_SAY_MS).toBeGreaterThanOrEqual(4_000);
    expect(JOIN_SAY_MS).toBeLessThanOrEqual(6_000);
  });

  test("a first join: whole from its arrival, yields JOIN_SAY_MS after the link is up", () => {
    const h = harness();
    h.g.arrived("d1");
    expect(h.last()).toBe(true);
    h.tick(1_500); // Connecting…
    h.g.live("d1");
    h.tick(JOIN_SAY_MS - 1);
    expect(h.last()).toBe(true);
    h.tick(1);
    expect(h.last()).toBe(false);
    expect(h.live()).toBe(0);
  });

  test("a link that never comes up: the pill still yields JOIN_SAY_MS after arrival", () => {
    const h = harness();
    h.g.arrived("d1");
    h.tick(JOIN_SAY_MS);
    expect(h.states).toEqual([true, false]);
  });

  test("the same id again (status flaps, a re-render, a second live) says nothing", () => {
    const h = harness();
    h.g.arrived("d1");
    h.g.live("d1");
    h.tick(JOIN_SAY_MS);
    h.g.arrived("d1");
    h.g.live("d1");
    expect(h.states).toEqual([true, false]);
    expect(h.live()).toBe(0);
  });

  test("live for an id that is not the one arriving, or with no arrival, does nothing", () => {
    const h = harness();
    h.g.live("d1");
    expect(h.states).toEqual([]);
    h.g.arrived("d2");
    h.g.live("d1");
    h.tick(JOIN_SAY_MS);
    expect(h.states).toEqual([true, false]);
  });

  test("a demo carried in from the last page (seen) gets no grace", () => {
    const h = harness();
    h.g.seen("d1");
    h.g.arrived("d1");
    h.g.live("d1");
    expect(h.states).toEqual([]);
  });

  test("a new demo id gets its own grace", () => {
    const h = harness();
    h.g.arrived("d1");
    h.tick(JOIN_SAY_MS);
    h.g.arrived("d2");
    expect(h.last()).toBe(true);
  });

  test("REQ-647's rule: input before RESTART_MIN_MS (from live) is ignored, after it the pill yields", () => {
    const h = harness();
    h.g.arrived("d1");
    h.g.live("d1");
    h.tick(RESTART_MIN_MS - 1);
    h.g.touched();
    expect(h.last()).toBe(true);
    h.tick(1);
    h.g.touched();
    expect(h.last()).toBe(false);
    expect(h.live()).toBe(0);
    h.g.touched();
    expect(h.states).toEqual([true, false]);
  });

  test("dispose stops the clock", () => {
    const h = harness();
    h.g.arrived("d1");
    h.g.dispose();
    expect(h.live()).toBe(0);
  });

  test("the overlay folds `joined` into yieldsRef, marks a carried demo seen, and lets input end the grace", () => {
    expect(overlay).toMatch(
      /yieldsRef\.current = !\(compact && open\) && !fresh && !joined;/,
    );
    expect(overlay).toMatch(/joinGrace\(\{ onChange: setJoined \}\)/);
    expect(overlay).toMatch(/joinRef\.current\?\.seen\(carried\.demo\.id\)/);
    expect(overlay).toMatch(/joinRef\.current\?\.arrived\(demo\.id\)/);
    expect(overlay).toMatch(/joinRef\.current\?\.live\(demo\.id\)/);
    expect(overlay).toMatch(/joinRef\.current\?\.touched\(\)/);
  });
});
