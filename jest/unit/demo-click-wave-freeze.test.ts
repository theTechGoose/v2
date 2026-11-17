/**
 * REQ-546 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 4, issue m14: the customer's click ripple on the staff stage misled. It stayed
 * on the NEXT card's button after a card swap (the wave fell back to the click's viewport
 * fraction once its node was gone), rode a re-laid-out node ~130 px off, and was drawn outside
 * the frame over the impersonation banner (a position:fixed ring is not clipped by the stage).
 *
 *   - `newStageWave` places a wave once, where it happened: on its node when the replay has it,
 *     else at the click's fraction of the frame;
 *   - `placeWavesAgain` keeps it frozen there (it follows only the frame's fit), drops it when its
 *     node goes away, the node re-lays out, or the replay's page load changes — and never falls
 *     back to the fraction for a wave that was on its node;
 *   - the stage wires both (no `placeOnStage(a).at` for waves).
 */
import * as fs from "fs";
import * as path from "path";
import * as mod from "../../front-end/lib/demo-mode/pointer-anchor";
import type { Anchor } from "../../shared/demo-mode/protocol";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

type Pt = { x: number; y: number };
type Box = { left: number; top: number; width: number; height: number };
type Frame = { box: Box; load: string | null; nodeAt(a: Anchor): Pt | null };
type SW = { id: number; x: number; y: number; a: Anchor };
// looked up at run time: a missing export fails its own tests, not the whole file
const m = mod as unknown as {
  newStageWave(id: number, a: Anchor, f: Frame): SW;
  placeWavesAgain(waves: SW[], f: Frame): SW[];
  WAVE_DRIFT_PX: number;
};

/** the fitted frame on the stage: 400 × 800 at (100, 60) */
const box: Box = { left: 100, top: 60, width: 400, height: 800 };
/** the customer clicked "Next month" — node 7 of load L1, at 50 % / 75 % of the viewport */
const click: Anchor = {
  vx: 0.5,
  vy: 0.75,
  n: { id: 7, x: 0.5, y: 0.5, l: "L1" },
};
/** where node 7 is drawn on the stage while the replay has it */
const NODE7: Pt = { x: 300, y: 650 };
const frame = (over: Partial<Frame> = {}): Frame => ({
  box,
  load: "L1",
  nodeAt: (a) => (a.n?.id === 7 && a.n.l === "L1" ? NODE7 : null),
  ...over,
});

describe("REQ-546 (demo m14, cycle 4) — a click wave stays where the click happened", () => {
  test("a new wave is placed on its node", () => {
    const w = m.newStageWave(1, click, frame());
    expect(w).toMatchObject({ id: 1, x: 300, y: 650 });
  });

  test("a card swap (the clicked node is gone) removes the wave — it never jumps to the fraction", () => {
    const w = m.newStageWave(1, click, frame());
    // the duration card replaced the month card in place: node 7 is gone; the fraction (0.5, 0.75)
    // of the frame would now be the new card's "1 week" button
    const out = m.placeWavesAgain([w], frame({ nodeAt: () => null }));
    expect(out).toEqual([]);
  });

  test("a new page load removes the wave", () => {
    const w = m.newStageWave(1, click, frame());
    const out = m.placeWavesAgain(
      [w],
      frame({ load: "L2", nodeAt: () => null }),
    );
    expect(out).toEqual([]);
  });

  test("a node that re-lays out (its card collapsed) removes the wave instead of riding it ~130 px", () => {
    const w = m.newStageWave(1, click, frame());
    const out = m.placeWavesAgain(
      [w],
      frame({ nodeAt: () => ({ x: NODE7.x, y: NODE7.y - 130 }) }),
    );
    expect(out).toEqual([]);
  });

  test("a wave whose node did not move keeps its place and the same array", () => {
    const waves = [m.newStageWave(1, click, frame())];
    expect(m.placeWavesAgain(waves, frame())).toBe(waves);
    // sub-pixel jitter of the node is not a re-layout
    const jitter = m.placeWavesAgain(
      waves,
      frame({ nodeAt: () => ({ x: NODE7.x + 0.5, y: NODE7.y - 0.5 }) }),
    );
    expect(jitter).toBe(waves);
    expect(m.WAVE_DRIFT_PX).toBeGreaterThan(0);
    expect(m.WAVE_DRIFT_PX).toBeLessThan(130);
  });

  test("a refit of the frame moves the wave with the frame, frozen at its spot in it", () => {
    const waves = [m.newStageWave(1, click, frame())];
    // the stage resized: the frame is now half as big at (0, 0); the node scales with it
    const small: Box = { left: 0, top: 0, width: 200, height: 400 };
    const out = m.placeWavesAgain(
      waves,
      frame({ box: small, nodeAt: () => ({ x: 100, y: 295 }) }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 1, x: 100, y: 295 });
  });

  test("a wave made before the frame had its node (mirror lag) sits at the fraction, then moves onto the node once and stays", () => {
    const early = m.newStageWave(1, click, frame({ nodeAt: () => null }));
    expect(early).toMatchObject({ x: 300, y: 660 }); // the fraction of the frame
    const onNode = m.placeWavesAgain([early], frame());
    expect(onNode).toHaveLength(1);
    expect(onNode[0]).toMatchObject({ x: 300, y: 650 });
    // from then on it is a wave on its node: the node going away removes it
    expect(m.placeWavesAgain(onNode, frame({ nodeAt: () => null }))).toEqual(
      [],
    );
  });

  test("a click made on the page the replay has not loaded yet waits for it, then lands on the node", () => {
    const lagging = m.newStageWave(
      1,
      click,
      frame({ load: "L0", nodeAt: () => null }),
    );
    const caught = m.placeWavesAgain([lagging], frame());
    expect(caught).toHaveLength(1);
    expect(caught[0]).toMatchObject({ x: 300, y: 650 });
  });

  test("a click with no node (off the mirrored page) stays frozen at its fraction until the load changes", () => {
    const bare: Anchor = { vx: 0.25, vy: 0.5 };
    const w = m.newStageWave(1, bare, frame());
    expect(w).toMatchObject({ x: 200, y: 460 });
    const waves = [w];
    expect(m.placeWavesAgain(waves, frame())).toBe(waves);
    expect(m.placeWavesAgain(waves, frame({ load: "L2" }))).toEqual([]);
  });
});

describe("REQ-546 (demo m14, cycle 4) — the stage wires the frozen waves", () => {
  const stage = read("front-end/islands/DemoStage.tsx");
  test("waves are made with newStageWave and placed again without the pointer's fraction fallback", () => {
    expect(stage).toMatch(/newStageWave\(/);
    expect(stage).not.toMatch(
      /placeWavesAgain\(w, \(a\) => placeOnStage\(a\)\.at\)/,
    );
    expect(stage).toMatch(/placeWavesAgain\(w, waveFrame\(\)\)/);
  });
  test("the stage hands the fitted frame to DemoPointer, which clips the waves to it", () => {
    expect(stage).toMatch(/<DemoPointer[\s\S]*?bounds=\{fit\}/);
  });
});
