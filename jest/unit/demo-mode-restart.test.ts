/**
 * REQ-298 (demo-loop cycle 1, issues M5 + M17) — a restarted demo says so. The customer's
 * "{name} ended the demo" notice is not silently replaced: a demo that arrives while the notice is
 * up, or within 30 s of an end, puts "{name} started a new demo" in the pill for a few seconds
 * before the plain "is guiding you" line. And the banner's Return question tells the only
 * presenter that leaving ends the demo for the customer.
 */
import * as fs from "fs";
import * as path from "path";
import {
  isRestart,
  RESTART_SAY_MS,
  RESTART_WINDOW_MS,
  restartNotice,
  returnAskText,
  startedText,
} from "../../shared/demo-mode/restart.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const hans = { userId: "u-hans", name: "Hans", color: "#2f6d29" };
const lia = { userId: "u-lia", name: "Lia", color: "#1f5fa8" };

function harness() {
  let now = 100_000;
  const timers: Array<{ fn: () => void; due: number; live: boolean }> = [];
  const states: boolean[] = [];
  const r = restartNotice({
    onChange: (fresh) => states.push(fresh),
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
    r,
    tick,
    states,
    last: () => states[states.length - 1],
    live: () => timers.filter((t) => t.live).length,
  };
}

describe("REQ-298 a demo that follows an end is announced as a new one", () => {
  test("the window is 30 s and the line stays a few seconds", () => {
    expect(RESTART_WINDOW_MS).toBe(30_000);
    expect(RESTART_SAY_MS).toBeGreaterThanOrEqual(3_000);
    expect(RESTART_SAY_MS).toBeLessThanOrEqual(6_000);
  });

  test("isRestart: a notice up, or an end within the window; never otherwise", () => {
    expect(isRestart({ noticeUp: true, endedAt: null, now: 1 })).toBe(true);
    expect(isRestart({ noticeUp: false, endedAt: null, now: 1 })).toBe(false);
    expect(isRestart({ noticeUp: false, endedAt: 1_000, now: 30_000 })).toBe(
      true,
    );
    expect(isRestart({ noticeUp: false, endedAt: 1_000, now: 31_001 })).toBe(
      false,
    );
  });

  test("notice up → a new id says it for RESTART_SAY_MS, then the plain line comes back", () => {
    const h = harness();
    h.r.ended();
    h.r.started(true);
    expect(h.last()).toBe(true);
    h.tick(RESTART_SAY_MS - 1);
    expect(h.last()).toBe(true);
    h.tick(1);
    expect(h.last()).toBe(false);
    expect(h.live()).toBe(0);
  });

  test("the notice dismissed: an end 29 s ago still says it, 31 s ago does not", () => {
    const a = harness();
    a.r.ended();
    a.tick(29_000);
    a.r.started(false);
    expect(a.last()).toBe(true);
    const b = harness();
    b.r.ended();
    b.tick(31_000);
    b.r.started(false);
    expect(b.states).toEqual([]);
    expect(b.live()).toBe(0);
  });

  test("no end at all (the first demo of the day): nothing is said", () => {
    const h = harness();
    h.r.started(false);
    expect(h.states).toEqual([]);
  });

  test("a second start re-arms the clock; an id arriving twice says it once; dispose stops the clock", () => {
    const h = harness();
    h.r.ended();
    h.r.started(true);
    h.tick(RESTART_SAY_MS - 500);
    // the demo cleared and a third one came, right after another end
    h.r.ended();
    h.r.started(false);
    expect(h.states).toEqual([true, true]);
    h.tick(RESTART_SAY_MS - 500);
    expect(h.last()).toBe(true); // the first clock did not cut the second line short
    h.tick(500);
    expect(h.last()).toBe(false);
    // the same id again (a re-render) says nothing: the end was consumed
    h.r.started(false);
    expect(h.states).toEqual([true, true, false]);
    h.r.ended();
    h.r.started(true);
    h.r.dispose();
    h.tick(RESTART_SAY_MS * 2);
    expect(h.last()).toBe(true); // nothing fired after dispose
    expect(h.live()).toBe(0);
  });

  test("startedText names the presenters; a demo written before the list has the opener; nobody → the plain line", () => {
    expect(startedText([hans], "")).toEqual({
      key: "demoMode.startedBy",
      vars: { name: "Hans" },
    });
    expect(startedText([hans, lia], "")).toEqual({
      key: "demoMode.startedBy",
      vars: { name: "Hans, Lia" },
    });
    expect(startedText([], "Hans")).toEqual({
      key: "demoMode.startedBy",
      vars: { name: "Hans" },
    });
    expect(startedText([], "")).toEqual({ key: "demoMode.started" });
  });
});

describe("REQ-298 the only presenter is told that leaving ends the demo", () => {
  test("returnAskText: one presenter → the alone copy; more → the plain one", () => {
    expect(returnAskText(1, "Ana")).toEqual({
      key: "demoMode.returnAskAlone",
      vars: { name: "Ana" },
    });
    expect(returnAskText(0, "Ana")).toEqual({
      key: "demoMode.returnAskAlone",
      vars: { name: "Ana" },
    });
    expect(returnAskText(2, "Ana")).toEqual({
      key: "demoMode.returnAsk",
      vars: { name: "Ana" },
    });
  });
});

describe("REQ-298 both dictionaries carry the lines", () => {
  test("startedBy, started, returnAskAlone in EN and ES", () => {
    for (const k of ["startedBy", "started", "returnAskAlone"]) {
      expect(typeof en[`demoMode.${k}`]).toBe("string");
      expect(typeof es[`demoMode.${k}`]).toBe("string");
      expect(en[`demoMode.${k}`]).not.toBe(es[`demoMode.${k}`]);
    }
    expect(en["demoMode.startedBy"]).toBe("{name} started a new demo");
    expect(es["demoMode.startedBy"]).toContain("{name}");
    expect(en["demoMode.returnAskAlone"]).toBe(
      "You are the only presenter — leaving ends the demo for {name}.",
    );
    expect(es["demoMode.returnAskAlone"]).toContain("{name}");
  });
});

describe("REQ-298 the islands are wired", () => {
  test("the overlay announces a restart in the pill and no longer wipes the notice blindly", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toMatch(/restartNotice\(/);
    expect(overlay).toMatch(/startedText\(/);
    expect(overlay).toContain('data-cy="demo-restarted"');
    // the phone's compact pill hides its details until tapped: a restart is shown anyway
    expect(overlay).toMatch(/compact && !open && !started \? "none"/);
    expect(overlay).not.toMatch(
      /useEffect\(\(\) => \{\s*if \(demo\) setNotice\(null\);\s*\}, \[demo\?\.id\]\);/,
    );
  });

  test("the banner passes the presenter count and the view picks the copy from it", () => {
    const banner = read("front-end/islands/ImpersonationBanner.tsx");
    expect(banner).toMatch(/presenters: a\.session\.presenters\.length/);
    const view = read("front-end/components/ImpersonationBannerView.tsx");
    expect(view).toMatch(/returnAskText\(/);
    expect(view).not.toMatch(/t\("demoMode\.returnAsk"/);
  });
});
