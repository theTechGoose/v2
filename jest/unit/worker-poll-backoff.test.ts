/**
 * REQ-605 — Raphael: "fix every issue the demo found, loop until there are none." Demo-loop
 * cycle 4 (run r857a9d67), issue m19 "Heavy polling (/api/admin/users, worker page)". RCA
 * (analyst CONFIRMED, skeptic UPHELD at ad104a19): /worker ran a fixed 5 s setInterval with no
 * idle back-off, and every tick re-fetched /field/worker/me, /field/worker/tasks AND
 * /field/worker/task-types — three requests every 5 s although me and task types rarely change.
 *
 * Now the worker screen polls through REQ-221's scheduler with REQ-424's idle back-off
 * (5 s base, 60 s cap), each tick reads only the tasks, and the full read (me + tasks + task
 * types) runs on login, on a language pick and on the catch-up after the tab was hidden.
 */
import * as fs from "fs";
import * as path from "path";
import type { PollEnv } from "../../front-end/lib/poll";
import {
  startWorkerRefresh,
  WORKER_REFRESH_MAX_MS,
  WORKER_REFRESH_MS,
} from "../../front-end/lib/worker-refresh";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** a hand-driven clock, document and window */
function fakeEnv() {
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const docListeners = new Set<() => void>();
  const winListeners = new Map<string, Set<() => void>>();
  const doc = {
    hidden: false,
    addEventListener: (_t: string, fn: () => void) => docListeners.add(fn),
    removeEventListener: (_t: string, fn: () => void) =>
      docListeners.delete(fn),
  };
  const activity = {
    addEventListener: (t: string, fn: () => void) => {
      if (!winListeners.has(t)) winListeners.set(t, new Set());
      winListeners.get(t)!.add(fn);
    },
    removeEventListener: (t: string, fn: () => void) => {
      winListeners.get(t)?.delete(fn);
    },
  };
  const clock = { now: 0 };
  const env: PollEnv = {
    now: () => clock.now,
    setInterval: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id: number) => {
      timers.delete(id);
    },
    doc,
    activity,
  };
  return {
    env,
    timers,
    docListeners,
    clock,
    periods: () => [...timers.values()].map((t) => t.ms),
    tick() {
      for (const t of [...timers.values()]) {
        clock.now += t.ms;
        t.fn();
      }
    },
    setHidden(h: boolean) {
      doc.hidden = h;
      for (const fn of [...docListeners]) fn();
    },
    input(type = "pointerdown") {
      for (const fn of [...(winListeners.get(type) ?? [])]) fn();
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(due = () => true) {
  const f = fakeEnv();
  const calls = { full: 0, tasks: 0 };
  const stop = startWorkerRefresh({
    full: () => {
      calls.full++;
    },
    tasks: () => {
      calls.tasks++;
    },
    due,
    env: f.env,
  });
  return { f, calls, stop };
}

describe("REQ-605 (demo cycle 4, m19): the worker screen's poll backs off and reads only tasks", () => {
  test("REQ-605 base 5 s, idle cap 60 s", () => {
    expect(WORKER_REFRESH_MS).toBe(5_000);
    expect(WORKER_REFRESH_MAX_MS).toBe(60_000);
  });

  test("REQ-605 a tick reads the tasks only — never me or task types", async () => {
    const { f, calls } = setup();
    for (let i = 0; i < 5; i++) {
      f.input(); // keep it at the base period
      f.tick();
      await flush();
    }
    expect(calls.tasks).toBe(5);
    expect(calls.full).toBe(0);
  });

  test("REQ-605 an idle page backs off 5 → 10 → 20 → 40 → 60 s and stays at the cap", async () => {
    const { f } = setup();
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(f.periods()[0]);
      f.tick();
      await flush();
    }
    expect(seen).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  test("REQ-605 an idle minute is at most 4 reads (was 12 ticks × 3 requests)", async () => {
    const { f, calls } = setup();
    while (f.clock.now < 60_000) {
      f.tick();
      await flush();
    }
    expect(calls.tasks + calls.full).toBeLessThanOrEqual(4);
  });

  test("REQ-605 input puts a backed-off poll straight back to 5 s", async () => {
    const { f } = setup();
    for (let i = 0; i < 4; i++) {
      f.tick();
      await flush();
    }
    expect(f.periods()[0]).toBeGreaterThan(5_000);
    f.input("keydown");
    expect(f.periods()[0]).toBe(5_000);
  });

  test("REQ-605 the catch-up after the tab was hidden is a FULL read (me + tasks + types)", async () => {
    const { f, calls } = setup();
    f.tick();
    await flush();
    f.setHidden(true);
    f.clock.now += 30_000;
    f.setHidden(false);
    await flush();
    expect(calls.full).toBe(1);
    // and the next tick is back to tasks only
    f.input();
    f.tick();
    await flush();
    expect(calls.full).toBe(1);
    expect(calls.tasks).toBe(2);
  });

  test("REQ-605 a tick the island says is not due reads nothing", async () => {
    const { f, calls } = setup(() => false);
    f.tick();
    f.tick();
    await flush();
    expect(calls).toEqual({ full: 0, tasks: 0 });
  });

  test("REQ-605 stop() removes every timer and listener", () => {
    const { f, stop } = setup();
    stop();
    expect(f.timers.size).toBe(0);
    expect(f.docListeners.size).toBe(0);
  });

  test("REQ-605 WorkerScreen polls through startWorkerRefresh, with no bare setInterval", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/worker-refresh\.ts"/);
    expect(src).not.toMatch(/setInterval\(/);
    const at = src.indexOf("startWorkerRefresh(");
    expect(at).toBeGreaterThan(-1);
    const call = src.slice(at, src.indexOf("});", at));
    expect(call).toMatch(/full:\s*load\b/);
    expect(call).toMatch(/tasks:\s*loadTasks\b/);
  });

  test("REQ-605 WorkerScreen's tasks-only read never calls me or task types", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    const at = src.indexOf("async function loadTasks(");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("\n  }\n", at));
    expect(body).toMatch(/workerClient\.tasks\(/);
    expect(body).not.toMatch(/workerClient\.me\(/);
    expect(body).not.toMatch(/workerClient\.taskTypes\(/);
  });

  test("REQ-605 a language pick on the switch re-reads me + task types (a full load)", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    const at = src.indexOf("rememberWorkerLangPick(c)");
    expect(at).toBeGreaterThan(-1);
    const handler = src.slice(at, src.indexOf("}}", at));
    expect(handler).toMatch(/\bload\(\)/);
  });
});
