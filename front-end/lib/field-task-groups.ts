/**
 * REQ-365 — the /field/tasks groups: one per worker + zone, titled "Worker · Zone".
 *
 * A one-off task for a customer with no subscription has no zone (`regionId` ""), and
 * the API answers its `regionName` as "". Such a task is grouped under the worker
 * alone and titled with the worker's name only — never "Miguel Torres · —"
 * (demo cycle 1, issue p15-17).
 */
import { zoneName } from "./field-zone-name.ts";

export interface GroupableTask {
  workerName: string;
  regionId?: string;
  regionName?: string;
  /** REQ-1162 (q3-94): the task's worker no longer exists — the API flags it */
  unassigned?: boolean;
}

/**
 * "Worker · Zone", or just "Worker" when the task has no zone; the zone in the account language (REQ-994).
 * REQ-1162: a task flagged `unassigned` reads `unassignedLabel` ("Unassigned"), never "—".
 */
export function workerZoneLabel(
  x: GroupableTask,
  lang: "en" | "es",
  unassignedLabel?: string,
): string {
  const who = x.unassigned && unassignedLabel ? unassignedLabel : x.workerName;
  const zone = x.regionName?.trim();
  return zone ? `${who} · ${zoneName(zone, lang)}` : who;
}

export interface TaskGroup<T> {
  key: string;
  title: string;
  rows: T[];
}

/** group by worker + zone id, in first-seen order */
export function groupTasks<T extends GroupableTask>(
  tasks: readonly T[],
  lang: "en" | "es",
  unassignedLabel?: string,
): TaskGroup<T>[] {
  const groups = new Map<string, TaskGroup<T>>();
  for (const x of tasks) {
    const key = `${x.workerName}|${x.regionId ?? ""}`;
    const g = groups.get(key);
    if (g) g.rows.push(x);
    else {
      groups.set(key, {
        key,
        title: workerZoneLabel(x, lang, unassignedLabel),
        rows: [x],
      });
    }
  }
  return [...groups.values()];
}
