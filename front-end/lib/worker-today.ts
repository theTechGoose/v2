/**
 * REQ-744 — demo-loop cycle 5, demo issue p18-8a: the worker view's day summary picks its
 * dictionary key by the task count, so one task is singular ("0 of 1 task done" /
 * "0 de 1 tarea lista") and an empty day says "No tasks today" / "Sin tareas hoy" instead of
 * "0 of 0 tasks done". Every key takes the same {done} and {n} vars.
 */
export type WorkerTodayKey =
  | "worker.today"
  | "worker.today.one"
  | "worker.today.none";

export function workerTodayKey(n: number): WorkerTodayKey {
  if (n === 0) return "worker.today.none";
  if (n === 1) return "worker.today.one";
  return "worker.today";
}

/**
 * REQ-1011 — LOOP-007 q1-97: one day, one story. The summary and the body read the same
 * split: `live` tasks (neither deferred nor skipped) are what the day counts, `deferred` ones
 * still draw their visit card (with its "deferred → tomorrow" hint) but no count. A day with
 * neither shows the empty state; a deferred-only day says so instead of "Nothing scheduled."
 */
export type WorkerDayCounts = { live: number; deferred: number };

export function workerDayCounts(
  rows: ReadonlyArray<{ status: string }>,
): WorkerDayCounts {
  let live = 0;
  let deferred = 0;
  for (const r of rows) {
    if (r.status === "deferred") deferred++;
    else if (r.status !== "skipped") live++;
  }
  return { live, deferred };
}
