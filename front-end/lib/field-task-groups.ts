/**
 * REQ-365 — the /field/tasks groups: one per worker + zone, titled "Worker · Zone".
 *
 * A one-off task for a customer with no subscription has no zone (`regionId` ""), and
 * the API answers its `regionName` as "". Such a task is grouped under the worker
 * alone and titled with the worker's name only — never "Miguel Torres · —"
 * (demo cycle 1, issue p15-17).
 */
export interface GroupableTask {
  workerName: string;
  regionId?: string;
  regionName?: string;
}

/** "Worker · Zone", or just "Worker" when the task has no zone */
export function workerZoneLabel(x: GroupableTask): string {
  const zone = x.regionName?.trim();
  return zone ? `${x.workerName} · ${zone}` : x.workerName;
}

export interface TaskGroup<T> {
  key: string;
  title: string;
  rows: T[];
}

/** group by worker + zone id, in first-seen order */
export function groupTasks<T extends GroupableTask>(
  tasks: readonly T[],
): TaskGroup<T>[] {
  const groups = new Map<string, TaskGroup<T>>();
  for (const x of tasks) {
    const key = `${x.workerName}|${x.regionId ?? ""}`;
    const g = groups.get(key);
    if (g) g.rows.push(x);
    else groups.set(key, { key, title: workerZoneLabel(x), rows: [x] });
  }
  return [...groups.values()];
}
