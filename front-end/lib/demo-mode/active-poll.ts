/**
 * REQ-153 / REQ-222 (demo issue M11) — the overlay's `GET /demo-mode/active` poll, as a function
 * of the connection state rather than a chain that only survives while it keeps re-arming itself.
 *
 *   - `now()`  asks at once (load, a roster change, the peer dropped);
 *   - `idle()` says "this side is not connected": an ask is due within `every` ms — the end of a
 *              connected demo included, which the old chain never restarted from;
 *   - after every answer (or failure), while not connected, the next ask is scheduled.
 *
 * One timer at most; an ask in flight re-arms the poll when it answers.
 */
export interface ActivePoll {
  now(): void;
  idle(): void;
  stop(): void;
}

export function activePoll(opts: {
  ask: () => Promise<unknown>;
  every: number;
  connected: () => boolean;
}): ActivePoll {
  let alive = true;
  let inFlight = 0;
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
    idle: arm,
    stop: () => {
      alive = false;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
