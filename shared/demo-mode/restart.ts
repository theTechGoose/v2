/**
 * REQ-298 (demo-loop cycle 1, M5 + M17) — a restarted demo says so; pure, shared by the overlay
 * island, the banner's view and jest.
 *
 *   - the customer's app auto-joins the next demo within the poll (REQ-153 amendment, REQ-222);
 *     before REQ-298 that silently took the place of the "{name} ended the demo" notice. Now a
 *     demo that arrives while the notice is up, or within RESTART_WINDOW_MS of an end, is a
 *     RESTART: the pill says "{name} started a new demo" (`startedText`) for RESTART_SAY_MS
 *     before its plain "is guiding you" line (`restartNotice` keeps the clock). REQ-647 (cycle 5,
 *     m23): ~10 s, or until the customer presses or types after RESTART_MIN_MS.
 *   - the banner's Return question (`returnAskText`): the only presenter is told that leaving
 *     ends the demo for the customer; with more presenters it stays "takes you out of the demo".
 */
import type { Presenter } from "./protocol.ts";

/** an end this long ago still makes the next demo a restart */
export const RESTART_WINDOW_MS = 30_000;
/** how long the pill says a new demo started. REQ-647 (cycle 5, m23): 4 s was gone before a
 *  person glanced at it — it now stays ~10 s, or until the customer acts (`touched`) */
export const RESTART_SAY_MS = 10_000;
/** REQ-647 — the customer's input clears the line only after it has been up this long */
export const RESTART_MIN_MS = 2_000;

/** is a demo arriving now a restart: the ended notice is up, or an end was within the window */
export function isRestart(
  o: { noticeUp: boolean; endedAt: number | null; now: number },
): boolean {
  if (o.noticeUp) return true;
  return o.endedAt !== null && o.now - o.endedAt <= RESTART_WINDOW_MS;
}

export interface RestartNotice {
  /** an end was just noticed: the window opens */
  ended(): void;
  /** a demo id arrived; `noticeUp`: the ended notice is still on screen. Says it when a restart */
  started(noticeUp: boolean): void;
  /** REQ-647 — the customer pressed or typed: the line has been read (after RESTART_MIN_MS) */
  touched(): void;
  /** stop the clock (unmount) */
  dispose(): void;
}

export function restartNotice(o: {
  /** true: say "started a new demo"; false: back to the plain line */
  onChange: (fresh: boolean) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}): RestartNotice {
  const now = o.now ?? (() => Date.now());
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as number));
  let endedAt: number | null = null;
  let timer: unknown = null;
  let saidAt = 0;
  const stop = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  return {
    ended() {
      endedAt = now();
    },
    started(noticeUp) {
      if (!isRestart({ noticeUp, endedAt, now: now() })) return;
      // the end is consumed: the same id again, or one with no end before it, says nothing
      endedAt = null;
      stop();
      saidAt = now();
      o.onChange(true);
      timer = setTimer(() => {
        timer = null;
        o.onChange(false);
      }, RESTART_SAY_MS);
    },
    touched() {
      if (timer === null || now() - saidAt < RESTART_MIN_MS) return;
      stop();
      o.onChange(false);
    },
    dispose: stop,
  };
}

/** REQ-821 (demo-loop cycle dm1, m9) — how long a first join keeps the whole pill out ("{name} is
 *  guiding you" with End) before it yields to the page (REQ-545/637/781). Short enough that a
 *  dense page is covered only briefly; the customer's input after RESTART_MIN_MS ends it sooner */
export const JOIN_SAY_MS = 5_000;

export interface JoinGrace {
  /** a demo id reached this tab: the first time it is seen, the whole pill shows (Connecting…
   *  included) — for JOIN_SAY_MS at most if the link never comes up */
  arrived(id: string): void;
  /** the link is up for this id: the JOIN_SAY_MS clock starts over, once, so "{name} is guiding
   *  you" is read with Connected */
  live(id: string): void;
  /** this id is already known (carried in from the last page): no grace for it */
  seen(id: string): void;
  /** the customer pressed or typed: the line has been read (after RESTART_MIN_MS) */
  touched(): void;
  /** stop the clock (unmount) */
  dispose(): void;
}

/**
 * REQ-821 — a first join gets the grace a restart gets (REQ-298/647): the REQ-153 amendment's
 * "{name} is guiding you" with End is on screen from the moment the demo arrives until JOIN_SAY_MS
 * after its link is up, or until the customer acts after RESTART_MIN_MS, before the pill yields.
 * Once per demo id: a page load that carries the demo in (REQ-535, every link is a full load)
 * calls `seen` and says nothing again.
 */
export function joinGrace(o: {
  /** true: keep the whole pill out; false: it may yield again */
  onChange: (joined: boolean) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}): JoinGrace {
  const now = o.now ?? (() => Date.now());
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as number));
  const known = new Set<string>();
  let current: string | null = null;
  let wentLive = false;
  let timer: unknown = null;
  let saidAt = 0;
  const stop = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const say = () => {
    stop();
    saidAt = now();
    timer = setTimer(() => {
      timer = null;
      o.onChange(false);
    }, JOIN_SAY_MS);
  };
  return {
    arrived(id) {
      if (known.has(id)) return;
      known.add(id);
      current = id;
      wentLive = false;
      say();
      o.onChange(true);
    },
    live(id) {
      if (id !== current || wentLive || timer === null) return;
      wentLive = true;
      say();
    },
    seen(id) {
      known.add(id);
    },
    touched() {
      if (timer === null || now() - saidAt < RESTART_MIN_MS) return;
      stop();
      o.onChange(false);
    },
    dispose: stop,
  };
}

/** the dictionary line for a new demo: the presenters by name, or the opener, or nobody */
export function startedText(
  presenters: Presenter[],
  presenterName: string | undefined,
): { key: string; vars?: { name: string } } {
  const names = presenters.length > 0
    ? presenters.map((p) => p.name).join(", ")
    : (presenterName ?? "").trim();
  return names
    ? { key: "demoMode.startedBy", vars: { name: names } }
    : { key: "demoMode.started" };
}

/** the banner's Return question: alone on the demo, leaving ends it for the customer */
export function returnAskText(
  presenters: number,
  name: string,
): { key: string; vars: { name: string } } {
  return {
    key: presenters <= 1 ? "demoMode.returnAskAlone" : "demoMode.returnAsk",
    vars: { name },
  };
}
