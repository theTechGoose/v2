/**
 * REQ-636 (demo-loop cycle 5, m8) — the customer's pill face rides a side channel (`pill`) while
 * the mirror frames trail by seconds, so the stage's ghost used to change before the frame it
 * belonged to (pair 3: "stage kept it collapsed; then mine collapsed too"). Each `pill` now
 * carries the frame clock (`t`: the customer's `link.now()`, the clock its mirror frames are
 * stamped with); the stage holds it until the replay has handed on a frame sent at or after `t`
 * (within PILL_SYNC_SLACK_MS). An unstamped pill (an older page) shows at once; a held pill never
 * waits past PILL_HOLD_MAX_MS (frames that stopped coming must not strand it); a follow switch
 * (`reset`) drops what is held — the new tab's pill waits for the new tab's own frames.
 */

/** a pill stamped this close after the replayed frame belongs to it (the two go out together) */
export const PILL_SYNC_SLACK_MS = 250;
/** the longest a pill waits for its frame */
export const PILL_HOLD_MAX_MS = 15_000;

export interface PillSync<P> {
  /** a pill message came in: what to show now (null: held for its frame). REQ-822 — `now`: show
   *  it at once (a change of the overlay's own state only), superseding what was held */
  offer(p: P, t?: number, now?: boolean): P | null;
  /** the replay handed on a frame the customer sent at `sent`: the held pill it reached, if any */
  frame(sent?: number): P | null;
  /** a held pill that waited PILL_HOLD_MAX_MS: show it anyway */
  due(): P | null;
  /** the stage follows another tab (or page): its clock starts over, nothing held */
  reset(): void;
  /** REQ-828 (dm2, p7) — the pill on show was shown at once (`now`) and no frame sent after it
   *  has been replayed since: a fold that follows is part of the same overlay gesture */
  atOnce(): boolean;
}

export function createPillSync<P>(
  o: { now?: () => number; slackMs?: number; maxHoldMs?: number } = {},
): PillSync<P> {
  const now = o.now ?? (() => Date.now());
  const slack = o.slackMs ?? PILL_SYNC_SLACK_MS;
  const maxHold = o.maxHoldMs ?? PILL_HOLD_MAX_MS;
  /** the latest send time of a frame the replay handed on */
  let at = -Infinity;
  /** held pills, in arrival order (the channel keeps their order) */
  let held: { p: P; t: number; got: number }[] = [];
  /** REQ-828 — the stamp of the pill shown at once, while no frame sent after it came (null:
   *  the pill on show came with its frame) */
  let quick: number | null = null;
  /** hand on the last of the first `n` held pills */
  const release = (n: number): P | null => {
    if (n <= 0) return null;
    const last = held[n - 1].p;
    held = held.slice(n);
    quick = null;
    return last;
  };
  return {
    offer(p, t, instant) {
      if (
        instant === true || t === undefined || !Number.isFinite(t) ||
        t <= at + slack
      ) {
        // newer than anything held: what was held is superseded
        held = [];
        // REQ-828 — an unstamped pill counts as sent now (any later frame ends the chain)
        quick = instant === true
          ? (t !== undefined && Number.isFinite(t) ? t : -Infinity)
          : null;
        return p;
      }
      held.push({ p, t, got: now() });
      return null;
    },
    frame(sent) {
      if (sent === undefined || !Number.isFinite(sent)) return null;
      if (sent > at) at = sent;
      // REQ-828 — a frame sent after the at-once pill: the page may have moved on with it
      if (quick !== null && sent > quick) quick = null;
      let n = 0;
      while (n < held.length && held[n].t <= at + slack) n++;
      return release(n);
    },
    due() {
      const t = now();
      let n = 0;
      while (n < held.length && t - held[n].got >= maxHold) n++;
      return release(n);
    },
    reset() {
      at = -Infinity;
      held = [];
      quick = null;
    },
    atOnce() {
      return quick !== null;
    },
  };
}
