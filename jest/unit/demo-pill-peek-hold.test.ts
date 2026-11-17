// REVISION (demo-loop run 15, by hand, 2026-11-17): REQ-820 AMENDMENT 4 + REQ-890 AMENDMENT 4 (dm15, p4 + m2): `held` asks pointerRests first; the tab's mousemove notes where it opened the peek before openPeek()
/**
 * REQ-820 — demo-loop cycle dm1, issues m6 + test-setup-m4: the customer's folded demo pill,
 * opened by a pointer resting on its right-edge tab, folded again after PILL_PEEK_MS (6 s) with
 * the pointer still on it; the tab re-mounted under the resting pointer, Chromium's hover update
 * gave it a mouseenter, it opened again — and each opening slid the whole pill in from the tab's
 * translate (x 1196 → 836 on a 1280 px window), half off-screen, every ~6 s.
 *
 * RCA (LIKELY, skeptic UPHELD and reproduced in Chromium): unpeekIn folded on its timer unless
 * End's question was up; holdPeek (the only thing that cleared the timer) ran on the pill div's
 * mouseenter, which fires before the tab's — while `peek` was still false — and never again while
 * the pointer stays inside; the tab opened on mouseenter, which a re-mounted node gets with no
 * pointer movement; and the whole pill's `transition:transform` animated from the tab's transform.
 *
 * Now: the fold timer waits again while the pill is HELD (a mouse/pen pointer on it, or End's
 * question up); the tab opens on real pointer movement (mousemove), a focus or a tap, never on a
 * bare mouseenter; and the frame that turns the tab into the whole pill has no transform glide.
 */
import * as fs from "fs";
import * as path from "path";
import { peekTimer, PILL_PEEK_MS } from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const overlay = () => read("front-end/islands/DemoModeOverlay.tsx");

describe("REQ-820 (demo-loop cycle dm1, m6 + test-setup-m4) — the peek's fold timer holds while the pill is held", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("not held: it folds once, after the time given", () => {
    const fold = jest.fn();
    const t = peekTimer({ held: () => false, fold });
    t.arm(PILL_PEEK_MS);
    jest.advanceTimersByTime(PILL_PEEK_MS - 1);
    expect(fold).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fold).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(PILL_PEEK_MS * 3);
    expect(fold).toHaveBeenCalledTimes(1);
  });

  test("a pointer resting on the pill for 20 s: it never folds; leaving folds it one wait later", () => {
    const fold = jest.fn();
    let over = true;
    const t = peekTimer({ held: () => over, fold });
    t.arm(PILL_PEEK_MS);
    jest.advanceTimersByTime(20_000);
    expect(fold).not.toHaveBeenCalled();
    over = false;
    t.arm(300);
    jest.advanceTimersByTime(299);
    expect(fold).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fold).toHaveBeenCalledTimes(1);
  });

  test("held when the timer fires, let go later: it folds at the next wait, not before", () => {
    const fold = jest.fn();
    let held = true;
    const t = peekTimer({ held: () => held, fold });
    t.arm(1000);
    jest.advanceTimersByTime(1500);
    held = false;
    jest.advanceTimersByTime(499);
    expect(fold).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fold).toHaveBeenCalledTimes(1);
  });

  test("arming again replaces the wait; cancel drops it", () => {
    const fold = jest.fn();
    const t = peekTimer({ held: () => false, fold });
    t.arm(1000);
    jest.advanceTimersByTime(900);
    t.arm(1000);
    jest.advanceTimersByTime(900);
    expect(fold).not.toHaveBeenCalled();
    t.cancel();
    jest.advanceTimersByTime(5000);
    expect(fold).not.toHaveBeenCalled();
  });
});

describe("REQ-820 — the island's wiring", () => {
  test("the overlay folds through peekTimer, held by a mouse/pen pointer on the pill or End's question", () => {
    const src = overlay();
    expect(src).toMatch(/peekTimer\(\{/);
    expect(src).toMatch(/overPillRef\.current/);
    // touch keeps a sticky :hover after a tap: only a mouse or pen counts as resting on it
    expect(src).toMatch(/onPointerEnter=\{[^}]*pointerType/);
    expect(src).toMatch(/onPointerLeave=/);
    expect(src).toMatch(/held: \(\) =>[\s\S]{0,400}demo-end-ask/);
  });

  test("the tab opens on real pointer movement, a focus or a tap — never a bare mouseenter (a re-mounted tab under a resting pointer gets one)", () => {
    const src = overlay();
    const tab = src.slice(
      src.indexOf('data-cy="demo-pill-tab"'),
      src.indexOf('data-cy="demo-pill-tab-end"'),
    );
    expect(tab).toMatch(/onMouseMove=\{\(e\) => \{[\s\S]{0,300}openPeek\(\);\s*\}\}/);
    expect(tab).not.toMatch(/onMouseEnter=/);
    expect(tab).toMatch(/onFocus=\{openPeek\}/);
    expect(tab).toMatch(/onClick=\{openPeek\}/);
  });

  test("the frame that turns the tab into the whole pill has no transform glide (it never slides in from the tab's translate)", () => {
    const src = overlay();
    expect(src).toMatch(/noGlide/);
    expect(src).toMatch(/noGlide\s*\?\s*"transition:none"/);
  });
});
