/**
 * REQ-473 (demo-loop cycle 3, issue M8) — one frame of the Ticker's ease from
 * 0 to `value`. A requestAnimationFrame timestamp can be EARLIER than the
 * performance.now() the animation started at, so `t` is clamped to [0,1]
 * (not just ≤1); and the result is normalised so it is never -0 —
 * Math.round(0 × negative) is -0, which renders "-0" and, because Preact's
 * setState compares with `!==` (-0 !== 0 is false), sticks forever.
 */
export function tickerFrame(
  value: number,
  start: number,
  now: number,
  duration: number,
): number {
  const raw = duration > 0 ? (now - start) / duration : 1;
  const t = Math.min(Math.max(raw, 0), 1);
  const eased = 1 - Math.pow(1 - t, 3);
  return Math.round(value * eased) || 0;
}
