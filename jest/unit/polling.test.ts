/**
 * REQ-221 — the demo found heavy polling of /api/agents/conversations?limit=50 and
 * /api/notifications?limit=10 (demo issue `pointer-and-replica-side-effects-polling`, RCA in
 * demo-rca.md). Cause: AsstThreads (8 s), DashTopbar (10 s + 30 s) and AsstChat's quote preview
 * (8 s) each ran a bare setInterval in every document — the stage's replica frame too, and a hidden
 * tab too — so one demo doubled every poll and a backgrounded tab kept them all going.
 *
 * The rule: every app poll goes through ONE scheduler (`front-end/lib/poll.ts`) that
 *  - never runs inside the demo stage's replica frame (it is a picture of the customer's screen,
 *    reloaded on every customer navigation; its own polls are pure duplicates),
 *  - does not tick while the document is hidden, and catches up once when it becomes visible,
 *  - never stacks a tick on top of one still in flight.
 */
import * as fs from "fs";
import * as path from "path";
import { type PollEnv, startPoll } from "../../front-end/lib/poll";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** a hand-driven clock + document */
function fakeEnv(opts: { replica?: boolean; hidden?: boolean } = {}) {
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const listeners = new Set<() => void>();
  const doc = {
    hidden: opts.hidden ?? false,
    addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
  };
  const env: PollEnv = {
    setInterval: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id: number) => {
      timers.delete(id);
    },
    doc,
    isReplica: () => opts.replica ?? false,
  };
  return {
    env,
    timers,
    listeners,
    /** fire every live interval once (one period elapses) */
    tick() {
      for (const t of [...timers.values()]) t.fn();
    },
    setHidden(h: boolean) {
      doc.hidden = h;
      for (const l of [...listeners]) l();
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("REQ-221 one poll scheduler", () => {
  test("it calls the fetch every period while the page is visible, and stop() ends it", async () => {
    const f = fakeEnv();
    let calls = 0;
    const stop = startPoll(
      () => {
        calls++;
      },
      8_000,
      { env: f.env },
    );
    expect([...f.timers.values()].map((t) => t.ms)).toEqual([8_000]);
    f.tick();
    await flush();
    f.tick();
    await flush();
    expect(calls).toBe(2);
    stop();
    expect(f.timers.size).toBe(0);
    expect(f.listeners.size).toBe(0);
  });

  test("immediate: one call at start, then the period", async () => {
    const f = fakeEnv();
    let calls = 0;
    startPoll(
      () => {
        calls++;
      },
      8_000,
      { env: f.env, immediate: true },
    );
    expect(calls).toBe(1);
  });

  test("inside the demo stage's replica frame it never polls — no timer, no call, no listener", () => {
    const f = fakeEnv({ replica: true });
    let calls = 0;
    const stop = startPoll(
      () => {
        calls++;
      },
      8_000,
      { env: f.env, immediate: true },
    );
    expect(calls).toBe(0);
    expect(f.timers.size).toBe(0);
    expect(f.listeners.size).toBe(0);
    stop(); // harmless
  });

  test("a hidden document does not poll; coming back catches up once and resumes", async () => {
    const f = fakeEnv();
    let calls = 0;
    startPoll(
      () => {
        calls++;
      },
      10_000,
      { env: f.env },
    );
    f.setHidden(true);
    expect(f.timers.size).toBe(0);
    f.tick();
    f.tick();
    expect(calls).toBe(0);
    f.setHidden(false);
    expect(calls).toBe(1); // the catch-up
    expect(f.timers.size).toBe(1);
    await flush();
    f.tick();
    await flush();
    expect(calls).toBe(2);
  });

  test("a page that starts hidden waits — no immediate call, no timer, until it is shown", () => {
    const f = fakeEnv({ hidden: true });
    let calls = 0;
    startPoll(
      () => {
        calls++;
      },
      8_000,
      { env: f.env, immediate: true },
    );
    expect(calls).toBe(0);
    expect(f.timers.size).toBe(0);
    f.setHidden(false);
    expect(calls).toBe(1);
    expect(f.timers.size).toBe(1);
  });

  test("a tick never stacks on a fetch still in flight", async () => {
    const f = fakeEnv();
    let calls = 0;
    let release!: () => void;
    startPoll(
      () => {
        calls++;
        return new Promise<void>((r) => (release = r));
      },
      8_000,
      { env: f.env },
    );
    f.tick();
    f.tick();
    f.tick();
    expect(calls).toBe(1);
    release();
    await flush();
    f.tick();
    expect(calls).toBe(2);
  });

  test("a throwing fetch is swallowed and the next tick still runs", async () => {
    const f = fakeEnv();
    let calls = 0;
    startPoll(
      () => {
        calls++;
        return Promise.reject(new Error("blip"));
      },
      8_000,
      { env: f.env },
    );
    f.tick();
    await flush();
    f.tick();
    await flush();
    expect(calls).toBe(2);
  });
});

describe("REQ-221 the app's polls all go through the scheduler", () => {
  const islands = [
    [
      "front-end/islands/AsstThreads.tsx",
      /assistantClient\.conversations\(50\)/,
    ],
    [
      "front-end/islands/DashTopbar.tsx",
      /dashboardClient\.notifications\(10\)/,
    ],
    ["front-end/islands/DashTopbar.tsx", /dashboardClient\.unreadCount\(\)/],
    ["front-end/islands/AsstChat.tsx", /quotesClient\.get\(qid\)/],
  ] as const;

  test.each(islands)(
    "%s polls %s through startPoll, not a bare setInterval",
    (file, call) => {
      const src = read(file);
      expect(src).toMatch(/from "\.\.\/lib\/poll\.ts"/);
      // the effect that makes the call hands it to startPoll
      const at = src.search(call);
      expect(at).toBeGreaterThan(-1);
      const effect = src.slice(
        src.lastIndexOf("useEffect(", at),
        src.indexOf("}, [", at),
      );
      expect(effect).toMatch(/startPoll\(/);
      expect(effect).not.toMatch(/setInterval\(/);
    },
  );

  test("AsstThreads no longer wires its own visibilitychange refresh (the scheduler does)", () => {
    const src = read("front-end/islands/AsstThreads.tsx");
    expect(src).not.toMatch(/visibilitychange/);
  });

  test("DashTopbar still stops its polls on logout and on pagehide (P-67)", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).toMatch(/addEventListener\("pm:logout", teardown\)/);
    expect(src).toMatch(/addEventListener\("pagehide", teardown\)/);
  });
});
