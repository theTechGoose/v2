/**
 * REQ-534 (demo-loop cycle 4, M8) — the signing pad's pen width, shared by the live pad and the
 * exported PNG so both draw the same line.
 *
 * Faster = thinner: 0.05 px/ms → 3.2 px, ~1.1 px/ms and faster → the floor. The floor was 0.9 px,
 * which a fast stroke (a quick flick, or a synthetic drag) always hit: once the demo stage scales
 * the customer's frame down, a 0.9 px antialiased line falls below one device pixel and the pad
 * reads as empty. 1.6 px stays visible there and on a phone.
 */
export const MIN_STROKE_PX = 1.6;
export const MAX_STROKE_PX = 3.2;

/** the pen width for a segment drawn at `speed` px/ms */
export function strokeWidth(speed: number): number {
  return Math.max(MIN_STROKE_PX, Math.min(MAX_STROKE_PX, 3.4 - speed * 1.6));
}
