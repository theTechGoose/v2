/**
 * REQ-221 — the one scheduler every app poll goes through.
 *
 * The demo (issue `pointer-and-replica-side-effects-polling`) showed each island running a bare
 * setInterval in every document: the stage's replica frame doubled every poll, and a hidden tab
 * kept them all going. REQ-242 replaced that frame with a mirror that runs no script at all
 * (sandboxed without allow-scripts), so no app poll can run on the stage. A poll here:
 *  - does not tick while the document is hidden, and catches up once when it is shown again —
 *    unless its last tick was under CATCHUP_MIN_MS ago (REQ-299: the demo's browser switched tabs
 *    for every screenshot, and each switch back was an extra fetch on top of the schedule),
 *  - never starts a tick while the previous one is still in flight,
 *  - swallows a failed fetch (the caller keeps its last good data; the next tick retries),
 *  - REQ-424 (demo cycle 2, p2) — with `idleMaxMs`, backs off while nobody is using the page:
 *    every tick with no user input since the last one doubles the period (up to the cap), and
 *    any input (ACTIVITY_EVENTS) puts it straight back to the base period.
 */
type TimerId = ReturnType<typeof setInterval> | number;

/** REQ-424 — the input that counts as "someone is using this page" */
export const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
] as const;

interface EventTargetLike {
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}

/** REQ-299 — a tab shown again this soon after its last tick does not catch up */
export const CATCHUP_MIN_MS = 2_000;

export interface PollEnv {
  /** the clock the catch-up debounce reads */
  now: () => number;
  setInterval: (fn: () => void, ms: number) => TimerId;
  clearInterval: (id: TimerId) => void;
  /** the document whose visibility gates the poll; null where there is none (SSR) */
  doc: {
    hidden: boolean;
    addEventListener: (type: string, fn: () => void) => void;
    removeEventListener: (type: string, fn: () => void) => void;
  } | null;
  /** REQ-424 — where user input is heard (the window); null where there is none (SSR) */
  activity?: EventTargetLike | null;
}

export interface PollOptions {
  /** one call right away (when visible), before the first period */
  immediate?: boolean;
  /** REQ-424 — back off while idle: the period doubles per input-less tick, up to this */
  idleMaxMs?: number;
  /** test seam; defaults to the browser's */
  env?: Partial<PollEnv>;
}

function browserEnv(): PollEnv {
  return {
    now: () => Date.now(),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (id) => globalThis.clearInterval(id as number),
    doc: typeof document === "undefined" ? null : document,
    activity: typeof document === "undefined"
      ? null
      : globalThis as unknown as EventTargetLike,
  };
}

/** a running poll: call it to stop; `catchUp()` runs now unless the last tick is fresh */
export type Poll = (() => void) & { catchUp: () => void };

/** start polling `fn` every `ms`; returns the stop function */
export function startPoll(
  fn: () => unknown,
  ms: number,
  opts: PollOptions = {},
): Poll {
  const env: PollEnv = { ...browserEnv(), ...opts.env };
  const maxMs = opts.idleMaxMs;
  /** the period armed now — `ms`, or more while backed off (REQ-424) */
  let period = ms;
  /** user input since the last tick */
  let active = false;

  let stopped = false;
  let inFlight = false;
  let timer: TimerId | null = null;
  /** when the last tick started; -Infinity until one has */
  let lastRun = -Infinity;

  const run = () => {
    if (stopped || inFlight) return;
    if (env.doc?.hidden) return;
    inFlight = true;
    lastRun = env.now();
    let result: unknown;
    try {
      result = fn();
    } catch {
      inFlight = false;
      return;
    }
    Promise.resolve(result).catch(() => {}).finally(() => {
      inFlight = false;
    });
  };
  /** a timer tick: REQ-424 — an input-less one backs the period off, an active one resets it */
  const tick = () => {
    if (maxMs !== undefined) {
      const next = active ? ms : Math.min(period * 2, Math.max(maxMs, ms));
      active = false;
      if (next !== period) {
        period = next;
        disarm();
        arm();
      }
    }
    run();
  };
  const arm = () => {
    if (timer === null) timer = env.setInterval(tick, period);
  };
  const disarm = () => {
    if (timer !== null) env.clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (stopped) return;
    if (env.doc?.hidden) {
      disarm();
    } else {
      // REQ-299: the catch-up only when the last tick is not fresh
      if (env.now() - lastRun >= CATCHUP_MIN_MS) run();
      arm();
    }
  };

  /** REQ-424 — someone used the page: a backed-off poll returns to its base period at once */
  const onActivity = () => {
    active = true;
    if (stopped || period === ms) return;
    period = ms;
    if (timer !== null) {
      disarm();
      arm();
    }
  };

  env.doc?.addEventListener("visibilitychange", onVisibility);
  if (maxMs !== undefined) {
    for (const k of ACTIVITY_EVENTS) {
      env.activity?.addEventListener(k, onActivity);
    }
  }
  if (!env.doc?.hidden) {
    if (opts.immediate) run();
    arm();
  }

  const stop = () => {
    stopped = true;
    disarm();
    env.doc?.removeEventListener("visibilitychange", onVisibility);
    if (maxMs !== undefined) {
      for (const k of ACTIVITY_EVENTS) {
        env.activity?.removeEventListener(k, onActivity);
      }
    }
  };
  return Object.assign(stop, {
    // REQ-424: debounced like the visibility catch-up (a focus right after a tick is no fetch)
    catchUp: () => {
      if (env.now() - lastRun >= CATCHUP_MIN_MS) run();
    },
  });
}
