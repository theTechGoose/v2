/**
 * REQ-833 (demo-loop cycle dm2, issue m6) — on a phone restart the customer never saw "{name} is
 * guiding you": REQ-821's join grace (JOIN_SAY_MS from link-up) ran out under REQ-298's 10 s
 * "started a new demo" line, so when the restart line dropped the pill yielded and folded at once;
 * and the compact pill hid its details (and with them the guiding line) unless opened or
 * restarting. Now the restart line, when its clock runs out, hands over to a fresh JOIN_SAY_MS of
 * "{name} is guiding you" (amends REQ-298/REQ-821), and the compact pill shows that line while the
 * grace is up.
 */
import * as fs from "fs";
import * as path from "path";
import {
  JOIN_SAY_MS,
  joinGrace,
  RESTART_MIN_MS,
  RESTART_SAY_MS,
  restartNotice,
} from "../../shared/demo-mode/restart.ts";
import { pillDetailsShown } from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const overlay = fs.readFileSync(
  path.join(ROOT, "front-end/islands/DemoModeOverlay.tsx"),
  "utf8",
);

/** both clocks on one fake timeline, wired the way the overlay wires them */
function harness() {
  let now = 100_000;
  const timers: Array<{ fn: () => void; due: number; live: boolean }> = [];
  const setTimer = (fn: () => void, ms: number) => {
    const h = { fn, due: now + ms, live: true };
    timers.push(h);
    return h;
  };
  const clearTimer = (h: unknown) => {
    (h as { live: boolean }).live = false;
  };
  let fresh = false;
  let joined = false;
  let id = "";
  const g = joinGrace({
    onChange: (j) => (joined = j),
    now: () => now,
    setTimer,
    clearTimer,
  });
  const r = restartNotice({
    onChange: (f, read) => {
      fresh = f;
      if (!f) g.restartEnded(id, read === true);
    },
    now: () => now,
    setTimer,
    clearTimer,
  });
  const tick = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers
        .filter((t) => t.live && t.due <= end)
        .sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      now = due.due;
      due.live = false;
      due.fn();
    }
    now = end;
  };
  /** the pill stays whole (does not yield): REQ-821's yieldsRef without the open details */
  const whole = () => fresh || joined;
  /** what the line says */
  const says = () => (fresh ? "started" : joined ? "guiding" : "yields");
  const restart = (newId: string) => {
    id = newId;
    r.started(true); // the ended notice is up: a restart
    g.arrived(newId);
  };
  // a first demo, joined and yielded
  restart("d0");
  return {
    g,
    r,
    tick,
    whole,
    says,
    restart,
    setNow: () => now,
    live: () => timers.filter((t) => t.live).length,
  };
}

describe("REQ-833 a restart says 'started a new demo', then '{name} is guiding you', then yields", () => {
  test("the line's clock running out hands over to a fresh JOIN_SAY_MS of the guiding line", () => {
    const h = harness();
    h.tick(60_000);
    h.r.ended();
    h.restart("d1");
    h.tick(1_000);
    h.g.live("d1"); // the link is up a second in
    expect(h.says()).toBe("started");
    h.tick(RESTART_SAY_MS - 1_000 - 1);
    expect(h.says()).toBe("started");
    h.tick(1); // the restart line ends: the grace (5 s after live) ran out under it before
    expect(h.says()).toBe("guiding");
    expect(h.whole()).toBe(true);
    h.tick(JOIN_SAY_MS - 1);
    expect(h.says()).toBe("guiding");
    h.tick(1);
    expect(h.says()).toBe("yields");
    expect(h.live()).toBe(0);
  });

  test("the customer's input after RESTART_MIN_MS ends the guiding phase", () => {
    const h = harness();
    h.tick(60_000);
    h.r.ended();
    h.restart("d1");
    h.g.live("d1");
    h.tick(RESTART_SAY_MS);
    expect(h.says()).toBe("guiding");
    h.tick(RESTART_MIN_MS - 1);
    h.r.touched();
    h.g.touched();
    expect(h.says()).toBe("guiding");
    h.tick(1);
    h.r.touched();
    h.g.touched();
    expect(h.says()).toBe("yields");
  });

  test("a restart line the customer dismissed by acting is not followed by another grace", () => {
    const h = harness();
    h.tick(60_000);
    h.r.ended();
    h.restart("d1");
    h.g.live("d1");
    h.tick(RESTART_MIN_MS + 4_000); // past the join grace
    h.r.touched();
    h.g.touched();
    expect(h.says()).toBe("yields");
    expect(h.live()).toBe(0);
  });

  test("once per demo id: a stale or repeated restartEnded says nothing", () => {
    const h = harness();
    h.tick(60_000);
    h.r.ended();
    h.restart("d1");
    h.g.live("d1");
    h.tick(RESTART_SAY_MS + JOIN_SAY_MS);
    expect(h.says()).toBe("yields");
    h.g.restartEnded("d1", false);
    h.g.restartEnded("d0", false);
    h.g.restartEnded("", false);
    expect(h.says()).toBe("yields");
    expect(h.live()).toBe(0);
  });

  test("the compact pill shows its details (the guiding line) while the join grace is up", () => {
    const base = { compact: true, open: false, started: false, joined: false };
    expect(pillDetailsShown(base)).toBe(false);
    expect(pillDetailsShown({ ...base, joined: true })).toBe(true);
    expect(pillDetailsShown({ ...base, started: true })).toBe(true);
    expect(pillDetailsShown({ ...base, open: true })).toBe(true);
    expect(pillDetailsShown({ ...base, compact: false })).toBe(true);
  });

  test("the overlay wires it: details by pillDetailsShown with joined, the restart's end into the join grace, the name said once", () => {
    expect(overlay).toMatch(
      /pillDetailsShown\(\{\s*compact,\s*open: shownOpen,\s*started: started !== null,\s*joined,?\s*\}\)/,
    );
    expect(overlay).toMatch(
      /joinRef\.current\?\.restartEnded\(\s*demoRef\.current\?\.id \?\? "",\s*read === true,?\s*\)/,
    );
    expect(overlay).toMatch(
      // REQ-838 also keeps it off while 'away' (reconciled on demo-fixes)
      /showGuide = copy\.showShort && !started && (?:!away && )?!joined;/,
    );
  });
});
