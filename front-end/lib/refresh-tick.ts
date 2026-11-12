/**
 * REQ-508 (demo-loop cycle 3, m20) — a fixed refresh interval skips the tick that lands right
 * after a reload something else already did (an action's own reload), so one action is not two
 * reads. `lastLoadAt` is when the last load STARTED: the interval's own loads are `everyMs`
 * apart and always pass; a reload started less than 80% of the interval ago is skipped.
 */
export function refreshTickDue(
  lastLoadAt: number,
  now: number,
  everyMs: number,
): boolean {
  return now - lastLoadAt >= everyMs * 0.8;
}
