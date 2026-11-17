/**
 * REQ-424 — Raphael: "fix every issue the demo found, loop until there are none." Demo-loop
 * cycle 2, issue p2 ("Heavy polling": /admin users + demo-mode active every 2–5 s on an idle
 * /admin, notifications/conversations every 1–2 s on the assistant, a double PUT /api/me).
 *
 * RCA (cycle 2, deb85b35): the polls never slow down for an idle page — /admin re-read its users
 * every 5 s plus once per focus AND once per visibilitychange (a tab switch is both), DashTopbar
 * re-fetched notifications on EVERY non-GET through lib/api (each chat message, each wizard
 * answer), AsstThreads polled every 8 s forever, and StaffNamePrompt guarded its save with React
 * state, which a fast Enter + click gets past before the re-render.
 *
 * Fix, pinned here:
 *  - poll.ts `idleMaxMs`: a poll's period doubles for every tick with no user input, up to the
 *    cap; any input (pointer, key, wheel, touch) puts it straight back to the base period.
 *  - `refreshWhileVisible` (/admin) is that poll + a focus catch-up debounced like the
 *    visibility one (one refresh for a focus+visibilitychange pair, none if the last is fresh).
 *  - mutation-refresh.ts: the topbar's refetch on `pm:mutated` runs at most once per
 *    MUTATION_REFRESH_GAP_MS (a burst is one trailing refetch) and ignores /agents/* chat posts.
 *  - AdminPage stops its refresh once the page is locked (a demo made the browser the customer).
 *  - StaffNamePrompt's in-flight guard is a ref.
 */
import * as fs from "fs";
import * as path from "path";
import { type PollEnv, startPoll } from "../../front-end/lib/poll";
import {
  ADMIN_REFRESH_MAX_MS,
  ADMIN_REFRESH_MS,
  refreshWhileVisible,
} from "../../front-end/lib/admin-console";
import {
  coalescedRefresh,
  isChatMutation,
  MUTATION_REFRESH_GAP_MS,
} from "../../front-end/lib/mutation-refresh";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function fakeTarget() {
  const ls = new Map<string, Set<(e?: unknown) => void>>();
  return {
    addEventListener: (k: string, f: (e?: unknown) => void) => {
      if (!ls.has(k)) ls.set(k, new Set());
      ls.get(k)!.add(f);
    },
    removeEventListener: (k: string, f: (e?: unknown) => void) => {
      ls.get(k)?.delete(f);
    },
    fire: (k: string) => [...(ls.get(k) ?? [])].forEach((f) => f()),
    count: (k: string) => ls.get(k)?.size ?? 0,
  };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** a hand-driven clock + document + window; `advance` runs every interval that comes due */
function fakeEnv() {
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; ms: number; at: number }>();
  const doc = { hidden: false, ...fakeTarget() };
  const win = fakeTarget();
  const clock = { now: 0 };
  const env: PollEnv = {
    now: () => clock.now,
    setInterval: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fn, ms, at: clock.now + ms });
      return id;
    },
    clearInterval: (id: number) => {
      timers.delete(id as number);
    },
    doc,
    activity: win,
  };
  return {
    env,
    timers,
    win,
    clock,
    /** move the clock to `to`, firing intervals in order as they come due (and letting each
     *  tick settle — the scheduler never stacks a tick on one in flight) */
    async advanceTo(to: number) {
      for (;;) {
        let next: [number, { fn: () => void; ms: number; at: number }] | null =
          null;
        for (const e of timers) {
          if (e[1].at <= to && (!next || e[1].at < next[1].at)) next = e;
        }
        if (!next) break;
        clock.now = next[1].at;
        next[1].at += next[1].ms;
        next[1].fn();
        await settle();
      }
      clock.now = to;
    },
    period: () => [...timers.values()].map((t) => t.ms),
  };
}

describe("REQ-424 (cycle 2, p2) an idle page's poll backs off; input brings it straight back", () => {
  test("each tick with no user input doubles the period, up to idleMaxMs", async () => {
    const f = fakeEnv();
    const fn = jest.fn();
    const stop = startPoll(fn, 5_000, { env: f.env, idleMaxMs: 40_000 });
    expect(f.period()).toEqual([5_000]);
    await f.advanceTo(5_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(f.period()).toEqual([10_000]);
    await f.advanceTo(15_000);
    expect(f.period()).toEqual([20_000]);
    await f.advanceTo(35_000);
    expect(f.period()).toEqual([40_000]);
    await f.advanceTo(75_000);
    expect(f.period()).toEqual([40_000]); // capped
    expect(fn).toHaveBeenCalledTimes(4);
    // one idle minute (from mount) cost 3 fetches, not 12
    stop();
    expect(f.timers.size).toBe(0);
    expect(f.win.count("keydown")).toBe(0);
    expect(f.win.count("pointerdown")).toBe(0);
  });

  test("user input resets a backed-off poll to its base period at once", async () => {
    const f = fakeEnv();
    const fn = jest.fn();
    startPoll(fn, 5_000, { env: f.env, idleMaxMs: 60_000 });
    await f.advanceTo(35_000); // ticks at 5, 15, 35 → period now 40 s
    expect(f.period()).toEqual([40_000]);
    f.win.fire("keydown");
    expect(f.period()).toEqual([5_000]);
    await f.advanceTo(40_000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  test("input during a period keeps the next tick at the base period", async () => {
    const f = fakeEnv();
    const fn = jest.fn();
    startPoll(fn, 5_000, { env: f.env, idleMaxMs: 60_000 });
    await f.advanceTo(1_000);
    f.win.fire("pointerdown");
    await f.advanceTo(5_000);
    expect(f.period()).toEqual([5_000]); // the user was active: no back-off
  });

  test("without idleMaxMs a poll keeps its fixed period (REQ-221 unchanged)", async () => {
    const f = fakeEnv();
    startPoll(() => {}, 8_000, { env: f.env });
    await f.advanceTo(80_000);
    expect(f.period()).toEqual([8_000]);
    expect(f.win.count("keydown")).toBe(0);
  });
});

describe("REQ-424 (cycle 2, p2) /admin's users refresh — idle back-off, one refresh per tab switch", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function adminEnv() {
    const doc = {
      ...fakeTarget(),
      visibilityState: "visible" as DocumentVisibilityState,
    };
    return { doc, win: fakeTarget() };
  }

  test("an idle /admin backs off to ADMIN_REFRESH_MAX_MS — one idle minute is at most 4 refreshes", async () => {
    const { doc, win } = adminEnv();
    const run = jest.fn();
    const stop = refreshWhileVisible(run, { doc, win });
    expect(ADMIN_REFRESH_MS).toBe(5_000);
    expect(ADMIN_REFRESH_MAX_MS).toBeGreaterThanOrEqual(60_000);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(run.mock.calls.length).toBeLessThanOrEqual(4);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });

  test("typing in the search box (a keydown) brings it back to every 5 s", async () => {
    const { doc, win } = adminEnv();
    const run = jest.fn();
    const stop = refreshWhileVisible(run, { doc, win });
    await jest.advanceTimersByTimeAsync(60_000);
    run.mockClear();
    win.fire("keydown");
    await jest.advanceTimersByTimeAsync(ADMIN_REFRESH_MS);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  test("a tab switch (focus + visibilitychange together) is ONE refresh, and none if the last is under 2 s old", async () => {
    const { doc, win } = adminEnv();
    const run = jest.fn();
    const stop = refreshWhileVisible(run, { doc, win });
    await jest.advanceTimersByTimeAsync(4_000);
    doc.fire("visibilitychange");
    win.fire("focus");
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(500);
    win.fire("focus");
    expect(run).toHaveBeenCalledTimes(1);
    stop();
    expect(win.count("focus")).toBe(0);
    expect(doc.count("visibilitychange")).toBe(0);
  });

  test("AdminPage stops the refresh once the page locks (a demo made this browser the customer)", () => {
    const src = read("front-end/islands/AdminPage.tsx");
    expect(src).toMatch(/stopRefreshRef\.current = refreshWhileVisible\(/);
    expect(src).toMatch(
      /useEffect\(\(\) => \{\s*if \(lock\) stopRefreshRef\.current\?\.\(\);\s*\}, \[lock\]\);/,
    );
  });
});

describe("REQ-424 (cycle 2, p2) the topbar's refetch on a mutation is coalesced and skips chat posts", () => {
  function fakeTimers() {
    const clock = { now: 0 };
    const pending = new Map<number, { fn: () => void; at: number }>();
    let id = 1;
    return {
      clock,
      pending,
      env: {
        now: () => clock.now,
        setTimeout: (fn: () => void, ms: number) => {
          const i = id++;
          pending.set(i, { fn, at: clock.now + ms });
          return i;
        },
        clearTimeout: (i: unknown) => {
          pending.delete(i as number);
        },
      },
      advanceTo(to: number) {
        for (const [i, p] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
          if (p.at > to) continue;
          clock.now = p.at;
          pending.delete(i);
          p.fn();
        }
        clock.now = to;
      },
    };
  }

  test("/agents/* posts are chat, not a business mutation", () => {
    expect(isChatMutation({ method: "POST", path: "/agents/chat" })).toBe(
      true,
    );
    expect(
      isChatMutation({ method: "POST", path: "/agents/conversations" }),
    ).toBe(true);
    expect(isChatMutation({ method: "POST", path: "/quotes/q1/send" })).toBe(
      false,
    );
    expect(isChatMutation(undefined)).toBe(false);
  });

  test("the first mutation refetches at once; a burst inside the gap is ONE trailing refetch", () => {
    const t = fakeTimers();
    const run = jest.fn();
    const r = coalescedRefresh(run, { gapMs: 5_000, env: t.env });
    r.onMutation({ method: "PUT", path: "/quotes/q1" });
    expect(run).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 4; i++) {
      t.advanceTo(i * 1_000);
      r.onMutation({ method: "POST", path: "/invoices/i1/claim" });
    }
    expect(run).toHaveBeenCalledTimes(1);
    t.advanceTo(5_000);
    expect(run).toHaveBeenCalledTimes(2); // the trailing one, not four
    t.advanceTo(30_000);
    expect(run).toHaveBeenCalledTimes(2);
    r.onMutation({ method: "POST", path: "/quotes/q2/send" });
    expect(run).toHaveBeenCalledTimes(3); // the gap has passed: at once again
  });

  test("chat posts never trigger a refetch", () => {
    const t = fakeTimers();
    const run = jest.fn();
    const r = coalescedRefresh(run, { gapMs: 5_000, env: t.env });
    for (let i = 0; i < 10; i++) {
      t.advanceTo(i * 1_500);
      r.onMutation({ method: "POST", path: "/agents/chat" });
    }
    t.advanceTo(60_000);
    expect(run).not.toHaveBeenCalled();
  });

  test("stop() drops a pending trailing refetch", () => {
    const t = fakeTimers();
    const run = jest.fn();
    const r = coalescedRefresh(run, { gapMs: 5_000, env: t.env });
    r.onMutation({ method: "PUT", path: "/me" });
    t.advanceTo(1_000);
    r.onMutation({ method: "PUT", path: "/me" });
    r.stop();
    t.advanceTo(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("MUTATION_REFRESH_GAP_MS is 5 s and DashTopbar routes MUTATION_EVENT through coalescedRefresh", () => {
    expect(MUTATION_REFRESH_GAP_MS).toBe(5_000);
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).toMatch(/coalescedRefresh\(/);
    expect(src).not.toMatch(
      /const onMutated = \(\) => \{\s*refreshNotifications\(\)/,
    );
  });
});

describe("REQ-424 (cycle 2, p2) the app's steady polls back off while idle", () => {
  test.each([
    [
      "front-end/islands/DashTopbar.tsx",
      /startPoll\(refreshNotifications, [^)]*idleMaxMs/,
    ],
    ["front-end/islands/DashTopbar.tsx", /30_000,\s*\{ idleMaxMs/],
    [
      "front-end/islands/AsstThreads.tsx",
      /startPoll\(refresh, POLL_MS, \{[^}]*idleMaxMs/,
    ],
  ])("%s passes idleMaxMs (%s)", (file, re) => {
    expect(read(file)).toMatch(re);
  });
});

describe("REQ-424 (cycle 2, p2) StaffNamePrompt — one save, one PUT /api/me", () => {
  test("the in-flight guard is a ref checked and set before the await (state lags a fast Enter + click)", () => {
    const src = read("front-end/islands/StaffNamePrompt.tsx");
    const save = src.slice(src.indexOf("async function save"));
    const body = save.slice(0, save.indexOf("await "));
    expect(body).toMatch(/\|\| inFlightRef\.current\) return;/);
    expect(body).toMatch(/inFlightRef\.current = true;/);
    expect(save).toMatch(/finally \{[\s\S]*inFlightRef\.current = false;/);
  });
});
