/**
 * REQ-639 (demo-loop cycle 5, issue c3-M6) — the customer's pointer is drawn on the stage only
 * on the frame it was made on. The customer's anchor names their LIVE page; the stage's replay
 * may still show an older frame (a chip row before it re-laid out, a scroll not yet sent), and
 * the arrow placed there landed one row off ("2–3 días" for "4 horas", "Custom" for "50/50").
 *
 *   - `anchorFrame`: the frame number (in its page load) that carries the screen an anchor was
 *     made on — the next frame to go out when the recorder holds changes not sent yet, else the
 *     last one sent.
 *   - `anchorAhead`: the replay shows an older frame (or an older page load) than that: the stage
 *     holds the customer's pointer where it was until the frame is applied.
 */
import type { Anchor } from "./protocol.ts";

/** what the stage's replay shows: its page load and the number of the last frame it applied */
export interface ShownFrame {
  load: string | null;
  seq: number | null;
}

/** the frame that carries the screen an anchor is made on now: `pushed` frames went out so far
 *  (numbered from 0); `waiting` — the recorder has changes the next frame will carry */
export function anchorFrame(pushed: number, waiting: boolean): number | null {
  const f = waiting ? pushed : pushed - 1;
  return f >= 0 ? f : null;
}

/** the replay is behind the frame the customer's anchor was made on. Never for an anchor that
 *  names no frame (a bare fraction, an older page's anchor) or an older page load's: those are
 *  placed as before. Page-load ids sort by load time. */
export function anchorAhead(a: Anchor | null, shown: ShownFrame): boolean {
  const n = a?.n;
  if (!n?.l || n.f === undefined) return false;
  if (shown.load === null || shown.seq === null) return true;
  if (n.l !== shown.load) return n.l > shown.load;
  return n.f > shown.seq;
}
