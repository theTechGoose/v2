/**
 * REQ-153 / REQ-222 (demo issue M11) — the overlay's `GET /demo-mode/active` poll, as a function
 * of the connection state rather than a chain that only survives while it keeps re-arming itself.
 *
 *   - `now()`  asks at once (load, a roster change, the peer dropped);
 *   - `catchUp()` asks only if the last ask began CATCHUP_MIN_MS or more ago — the tab shown
 *              again (REQ-299: a tab flap per screenshot was an extra ask each time);
 *   - `idle()` says "this side is not connected": an ask is due within `every` ms — the end of a
 *              connected demo included, which the old chain never restarted from;
 *   - after every answer (or failure), while not connected, the next ask is scheduled.
 *
 * One timer at most; an ask in flight re-arms the poll when it answers.
 */
import { CATCHUP_MIN_MS } from "../poll.ts";

export interface ActivePoll {
  now(): void;
  catchUp(): void;
  idle(): void;
  stop(): void;
}

export function activePoll(opts: {
  ask: () => Promise<unknown>;
  every: number;
  connected: () => boolean;
  /** test seam; defaults to Date.now */
  clock?: () => number;
}): ActivePoll {
  const clock = opts.clock ?? (() => Date.now());
  let alive = true;
  let inFlight = 0;
  /** when the last ask began; -Infinity until one has */
  let lastAsk = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    if (!alive || opts.connected() || inFlight > 0 || timer !== undefined) {
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      check();
    }, opts.every);
  };

  const check = async () => {
    if (!alive) return;
    clearTimeout(timer);
    timer = undefined;
    inFlight++;
    lastAsk = clock();
    try {
      await opts.ask();
    } catch {
      // signed out, or the backend is away — ask again later
    } finally {
      inFlight--;
    }
    arm();
  };

  return {
    now: () => void check(),
    catchUp: () => {
      if (clock() - lastAsk >= CATCHUP_MIN_MS) void check();
    },
    idle: arm,
    stop: () => {
      alive = false;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
