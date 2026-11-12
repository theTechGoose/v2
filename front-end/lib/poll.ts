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
 *  - swallows a failed fetch (the caller keeps its last good data; the next tick retries).
 */
type TimerId = ReturnType<typeof setInterval> | number;

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
}

export interface PollOptions {
  /** one call right away (when visible), before the first period */
  immediate?: boolean;
  /** test seam; defaults to the browser's */
  env?: Partial<PollEnv>;
}

function browserEnv(): PollEnv {
  return {
    now: () => Date.now(),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (id) => globalThis.clearInterval(id as number),
    doc: typeof document === "undefined" ? null : document,
  };
}

/** start polling `fn` every `ms`; returns the stop function */
export function startPoll(
  fn: () => unknown,
  ms: number,
  opts: PollOptions = {},
): () => void {
  const env: PollEnv = { ...browserEnv(), ...opts.env };

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
  const arm = () => {
    if (timer === null) timer = env.setInterval(run, ms);
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

  env.doc?.addEventListener("visibilitychange", onVisibility);
  if (!env.doc?.hidden) {
    if (opts.immediate) run();
    arm();
  }

  return () => {
    stopped = true;
    disarm();
    env.doc?.removeEventListener("visibilitychange", onVisibility);
  };
}
