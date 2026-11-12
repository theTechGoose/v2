/**
 * REQ-221 — the one scheduler every app poll goes through.
 *
 * The demo (issue `pointer-and-replica-side-effects-polling`) showed each island running a bare
 * setInterval in every document: the stage's replica frame doubled every poll, and a hidden tab
 * kept them all going. REQ-242 replaced that frame with a mirror that runs no script at all
 * (sandboxed without allow-scripts), so no app poll can run on the stage. A poll here:
 *  - does not tick while the document is hidden, and catches up once when it is shown again,
 *  - never starts a tick while the previous one is still in flight,
 *  - swallows a failed fetch (the caller keeps its last good data; the next tick retries).
 */
type TimerId = ReturnType<typeof setInterval> | number;

export interface PollEnv {
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

  const run = () => {
    if (stopped || inFlight) return;
    if (env.doc?.hidden) return;
    inFlight = true;
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
      run();
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
