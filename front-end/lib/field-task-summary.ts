/**
 * REQ-284 — the counts in the /field/tasks summary row and eyebrow.
 *
 * `toDo` is the tasks still open (status "assigned"): a COUNTER, worn as "To do" —
 * not the per-task status label "Assigned", which read as "nobody is on it" once the
 * day's only task was done (demo issue customers-payments-fieldops-m4).
 */
import type { TaskStatus } from "../clients/field.ts";

export interface DaySummary {
  /** checked off */
  done: number;
  /** still open — counted, not yet done */
  toDo: number;
  /** skipped or deferred off the day */
  notDone: number;
  /** done + toDo — the "{done} of {n} complete" denominator */
  counted: number;
}

export function daySummary(
  tasks: readonly { status: TaskStatus }[],
): DaySummary {
  let done = 0, toDo = 0, notDone = 0;
  for (const x of tasks) {
    if (x.status === "complete") done++;
    else if (x.status === "assigned") toDo++;
    else notDone++;
  }
  return { done, toDo, notDone, counted: done + toDo };
}
