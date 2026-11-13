/**
 * REQ-180 — the demo pointer glides: the sender's moves are throttled leading + trailing (the
 * first goes now, the last of a burst goes at the gap's end, so the rest position is never
 * dropped), each move carries the sender's clock so a late one on the unordered channel is
 * ignored, and the receiver glides the drawn pointer toward every new target frame by frame
 * (exponential approach, never overshooting) instead of snapping with a CSS transition.
 */
import * as fs from "fs";
import * as path from "path";
import {
  GLIDE_TAU_MS,
  glideStep,
  MOVE_GAP_DIRECT_MS,
  MOVE_GAP_RELAY_MS,
  moveThrottle,
  newerMove,
} from "../../shared/demo-mode/motion.ts";
import { parsePeerMessage } from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-180 — the sender's rate", () => {
  test("direct runs at the screen's rate, the relay at a gentler one", () => {
    expect(MOVE_GAP_DIRECT_MS).toBeLessThanOrEqual(17);
    expect(MOVE_GAP_RELAY_MS).toBeLessThanOrEqual(70);
    expect(MOVE_GAP_DIRECT_MS).toBeLessThan(MOVE_GAP_RELAY_MS);
  });

  test("leading + trailing: the first move goes now, the last of a burst at the gap's end", () => {
    let now = 0;
    const sent: Array<{ at: number; v: string }> = [];
    const timers: Array<{ fn: () => void; due: number; live: boolean }> = [];
    const th = moveThrottle<string>({
      gap: () => 16,
      send: (v) => sent.push({ at: now, v }),
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
    const tick = (to: number) => {
      now = to;
      for (const t of timers) {
        if (t.live && t.due <= now) {
          t.live = false;
          t.fn();
        }
      }
    };
    th.push("a");
    expect(sent).toEqual([{ at: 0, v: "a" }]);
    tick(5);
    th.push("b");
    tick(10);
    th.push("c");
    tick(12);
    th.push("d");
    expect(sent).toHaveLength(1);
    tick(16);
    expect(sent).toEqual([{ at: 0, v: "a" }, { at: 16, v: "d" }]);
    tick(40);
    th.push("e");
    expect(sent[2]).toEqual({ at: 40, v: "e" });
    tick(45);
    th.push("f");
    th.cancel();
    tick(100);
    expect(sent).toHaveLength(3);
  });

  test("a late move on the unordered channel is ignored, an unstamped one never", () => {
    expect(newerMove(100, 101)).toBe(true);
    expect(newerMove(100, 100)).toBe(true);
    expect(newerMove(100, 99)).toBe(false);
    expect(newerMove(100, undefined)).toBe(true);
    expect(newerMove(0, 5)).toBe(true);
  });

  test("a move message carries the sender's clock through the parser", () => {
    const m = parsePeerMessage({
      k: "move",
      a: { vx: 0.5, vy: 0.5 },
      t: 1234.5,
    });
    expect(m).toEqual({ k: "move", a: { vx: 0.5, vy: 0.5 }, t: 1234.5 });
    expect(parsePeerMessage({ k: "move", a: { vx: 0.5, vy: 0.5 } })).toEqual({
      k: "move",
      a: { vx: 0.5, vy: 0.5 },
    });
    expect(parsePeerMessage({ k: "move", a: { vx: 0.5, vy: 0.5 }, t: "x" }))
      .toEqual({
        k: "move",
        a: { vx: 0.5, vy: 0.5 },
      });
  });
});

describe("REQ-180 — the receiver's glide", () => {
  test("approaches the target every frame, never overshoots, and settles on it", () => {
    let at = { x: 0, y: 0 };
    const target = { x: 100, y: 50 };
    let last = 0;
    let frames = 0;
    let settled = false;
    while (!settled && frames < 100) {
      const s = glideStep(at, target, 16);
      expect(s.at.x).toBeGreaterThan(last);
      expect(s.at.x).toBeLessThanOrEqual(100);
      expect(s.at.y / s.at.x).toBeCloseTo(0.5, 6);
      last = s.at.x;
      at = s.at;
      settled = s.settled;
      frames++;
    }
    expect(settled).toBe(true);
    expect(at).toEqual(target);
    // a few frames, not instant and not a crawl
    expect(frames).toBeGreaterThanOrEqual(3);
    expect(frames).toBeLessThanOrEqual(40);
    expect(GLIDE_TAU_MS).toBeGreaterThanOrEqual(30);
    expect(GLIDE_TAU_MS).toBeLessThanOrEqual(120);
  });

  test("no time, no motion; a long gap lands at once", () => {
    expect(glideStep({ x: 0, y: 0 }, { x: 100, y: 0 }, 0).at).toEqual({
      x: 0,
      y: 0,
    });
    const s = glideStep({ x: 0, y: 0 }, { x: 100, y: 0 }, 5_000);
    expect(s.settled).toBe(true);
    expect(s.at).toEqual({ x: 100, y: 0 });
  });
});

describe("REQ-180 — the overlay and the stage are wired to it", () => {
  // REQ-187/188 (2026-11-05): the glide lives in one hook both islands use; a move is a viewport
  // fraction (the overlay's own viewport, the stage's fitted frame)
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  const stage = read("front-end/islands/DemoStage.tsx");
  const glide = read("front-end/lib/demo-mode/use-glide.ts");
  test("sends through the throttle with the sender's clock, drops late moves, glides the drawn pointer", () => {
    for (const island of [overlay, stage]) {
      expect(island).toMatch(
        /from "\.\.\/\.\.\/shared\/demo-mode\/motion\.ts"/,
      );
      expect(island).toMatch(/moveThrottle/);
      // REQ-242 (2026-11-11): a move is the viewport fraction plus the mirrored element under it
      expect(island).toMatch(
        /k: "move",\s*a: anchorOf\(\{ x, y \}\),\s*t: performance\.now\(\)/,
      );
      // REQ-371 (demo m10, cycle 2): the overlay's anchoring lives in pointer-anchor.ts (anchorAt)
      expect(
        island === overlay
          ? read("front-end/lib/demo-mode/pointer-anchor.ts")
          : island,
      ).toMatch(/const a = pointToFrac\(p, /);
      expect(island).toMatch(/newerMove\(/);
      expect(island).toMatch(/MOVE_GAP_DIRECT_MS : MOVE_GAP_RELAY_MS/);
    }
    // REQ-214 (2026-11-06): the overlay draws one pointer PER PRESENTER through PeerPointer,
    // which owns that pointer's glide; the stage keeps its own glide for the customer's pointer
    const peer = read("front-end/components/demo-mode/PeerPointer.tsx");
    expect(peer).toMatch(/useGlide\(\)/);
    expect(peer).toMatch(/glide\.glideTo\(/);
    expect(overlay).toMatch(/<PeerPointer/);
    expect(stage).toMatch(/useGlide\(\)/);
    expect(stage).toMatch(/glide\.glideTo\(/);
    expect(glide).toMatch(/glideStep\(/);
    // the drawn position is written frame by frame, never a snap through a CSS transition
    expect(glide).not.toMatch(/transition:transform/);
    expect(glide).not.toMatch(/translate\(\$\{pointer\.x\}px/);
    expect(glide).toMatch(/style\.transform = `translate\(/);
    const pointer = read("front-end/components/demo-mode/DemoPointer.tsx");
    expect(pointer).not.toMatch(/transition:transform/);
  });
});
