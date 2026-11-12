/**
 * REQ-534 (demo-loop cycle 4, M8) — a drawn signature shows on the stage while it is drawn.
 *
 * The recorder mirrored canvases only on a 1 s poll, and the pad's fastest strokes were 0.9 px
 * wide — below one device pixel once the stage scales the frame down, so the stage's pad looked
 * empty until after signing. Now:
 *  - a pointer event on a mirrored <canvas> schedules a canvas flush right away, throttled to
 *    CANVAS_INK_MS (~100 ms), so ink streams to the stage while it is drawn;
 *  - the pen width never drops below MIN_STROKE_PX (1.6 px), on the live pad and in the export
 *    (one `strokeWidth` serves both).
 */
import * as fs from "fs";
import * as path from "path";
import {
  CANVAS_INK_MS,
  createRecorder,
} from "../../front-end/lib/demo-mode/mirror-record";
import type { MirrorFrame } from "../../shared/demo-mode/mirror";
import { MIN_STROKE_PX, strokeWidth } from "../../front-end/lib/signature-ink";
import {
  docWith,
  FakeMutationObserver,
  FDocument,
  FElement,
  find,
  h,
} from "./support/fake-dom";

const INK = (n: number) => `data:image/png;base64,INK${n}`;

const padPage = () =>
  docWith((d) =>
    h(
      d,
      "html",
      {},
      h(d, "head"),
      h(
        d,
        "body",
        {},
        h(
          d,
          "div",
          { class: "pad" },
          h(d, "canvas", { width: "640", height: "400" }),
        ),
      ),
    )
  );
const canvasOf = (doc: FDocument) =>
  find(doc, (e) => e.localName === "canvas") as FElement;

/** a live (timer-driven) recorder; the sweep is pushed far out so only the ink path can send */
function live(doc: FDocument, out: MirrorFrame[]) {
  return createRecorder(doc as unknown as Document, {
    emit: (f) => out.push(JSON.parse(JSON.stringify(f))),
    Observer: FakeMutationObserver as unknown as typeof MutationObserver,
    sweepMs: 60_000,
  });
}
const cvOps = (frames: MirrorFrame[]) =>
  frames.flatMap((f) => f.ops.filter((o) => o.o === "cv"));

describe("REQ-534 (cycle 4, M8) — ink streams to the stage while it is drawn", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("REQ-534 the throttle is about 100 ms", () => {
    expect(CANVAS_INK_MS).toBeGreaterThanOrEqual(50);
    expect(CANVAS_INK_MS).toBeLessThanOrEqual(150);
  });

  test("REQ-534 a pointermove on the pad sends its bitmap within ~100 ms, not on the 1 s sweep", () => {
    const doc = padPage();
    const canvas = canvasOf(doc);
    const frames: MirrorFrame[] = [];
    const r = live(doc, frames);
    r.snapshot();
    const id = r.idOf(canvas as unknown as Node);
    const before = cvOps(frames).length;
    canvas.bitmap = INK(1);
    doc.fire("pointerdown", canvas);
    doc.fire("pointermove", canvas);
    jest.advanceTimersByTime(CANVAS_INK_MS ?? 100);
    expect(cvOps(frames).slice(before)).toEqual([
      { o: "cv", i: id, u: INK(1) },
    ]);
    r.stop();
  });

  test("REQ-534 a burst of pointermoves is throttled: at most one canvas flush per CANVAS_INK_MS, and the last ink always goes out", () => {
    const ms = CANVAS_INK_MS ?? 100;
    const doc = padPage();
    const canvas = canvasOf(doc);
    const frames: MirrorFrame[] = [];
    const r = live(doc, frames);
    r.snapshot();
    const before = cvOps(frames).length;
    // 600 ms of drawing, a pointermove every 5 ms with new ink each time
    let n = 0;
    for (let t = 0; t < 600; t += 5) {
      canvas.bitmap = INK(++n);
      doc.fire("pointermove", canvas);
      jest.advanceTimersByTime(5);
    }
    canvas.bitmap = INK(++n);
    doc.fire("pointerup", canvas);
    jest.advanceTimersByTime(ms * 2);
    const sent = cvOps(frames).slice(before);
    // streamed while drawn (several bitmaps), but not one per event
    expect(sent.length).toBeGreaterThanOrEqual(600 / ms - 1);
    expect(sent.length).toBeLessThanOrEqual(600 / ms + 2);
    // the stroke's final state reached the stage
    expect(sent[sent.length - 1]).toMatchObject({ o: "cv", u: INK(n) });
    r.stop();
  });

  test("REQ-534 pointer events off a canvas send no cv", () => {
    const doc = padPage();
    const canvas = canvasOf(doc);
    const pad = find(doc, (e) => e.localName === "div") as FElement;
    const frames: MirrorFrame[] = [];
    const r = live(doc, frames);
    r.snapshot();
    const before = cvOps(frames).length;
    canvas.bitmap = INK(9);
    doc.fire("pointermove", pad); // not the canvas
    jest.advanceTimersByTime(300);
    expect(cvOps(frames).length).toBe(before);
    r.stop();
  });

  test("REQ-534 the recorder listens for pointer events while attached and lets go when paused", () => {
    const doc = padPage();
    const r = live(doc, []);
    r.snapshot();
    expect(doc.listening("pointermove")).toBe(1);
    expect(doc.listening("pointerup")).toBe(1);
    r.pause();
    expect(doc.listening("pointermove")).toBe(0);
    expect(doc.listening("pointerup")).toBe(0);
    r.stop();
  });
});

describe("REQ-534 (cycle 4, M8) — the pen is never thinner than 1.6 px", () => {
  test("REQ-534 MIN_STROKE_PX is about 1.6 px", () => {
    expect(MIN_STROKE_PX).toBeGreaterThanOrEqual(1.5);
    expect(MIN_STROKE_PX).toBeLessThanOrEqual(2);
  });

  test("REQ-534 a fast (synthetic, several px per ms) stroke gets the floor, not 0.9 px", () => {
    expect(strokeWidth(5)).toBe(MIN_STROKE_PX);
    expect(strokeWidth(50)).toBe(MIN_STROKE_PX);
  });

  test("REQ-534 slow strokes still get the thicker, speed-sensitive width up to 3.2 px", () => {
    expect(strokeWidth(0)).toBe(3.2);
    expect(strokeWidth(0.05)).toBeCloseTo(3.2, 5);
    const mid = strokeWidth(0.8);
    expect(mid).toBeGreaterThan(MIN_STROKE_PX);
    expect(mid).toBeLessThan(3.2);
    expect(strokeWidth(0.2)).toBeGreaterThan(strokeWidth(0.8));
  });

  test("REQ-534 the pad draws every segment (live and export) with strokeWidth — no private 0.9 floor", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../front-end/islands/PublicSignQuote.tsx"),
      "utf8",
    );
    expect(src).toMatch(
      /import\s*\{[^}]*strokeWidth[^}]*\}\s*from\s*"\.\.\/lib\/signature-ink\.ts"/,
    );
    expect(src).toMatch(/ctx\.lineWidth\s*=\s*strokeWidth\(/);
    expect(src).not.toMatch(/Math\.max\(\s*0\.9/);
  });
});
