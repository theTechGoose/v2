/**
 * REQ-786 (demo dv1) — the owner opens ONE worker's hours: a worker row on /field/workers links to
 * /field/timesheet?worker=<id>, and the timesheet narrows its week (shifts and punch log) to them.
 */
import type { Punch, Report } from "../clients/timeclock.ts";

/** the link from a worker's row to their hours */
export const timesheetHref = (workerId: string): string =>
  `/field/timesheet?worker=${encodeURIComponent(workerId)}`;

/** the worker the timesheet is narrowed to, from a location.search; null for everyone */
export function workerFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("worker");
  return id ? id : null;
}

/** the week's report and punches, narrowed to one worker (or all when workerId is null) */
export function onlyWorker(
  report: Report | null,
  punches: Punch[],
  workerId: string | null,
): { report: Report | null; punches: Punch[] } {
  if (!workerId) return { report, punches };
  return {
    report: report
      ? {
        ...report,
        workers: report.workers.filter((r) => r.worker.id === workerId),
      }
      : null,
    punches: punches.filter((p) => p.workerId === workerId),
  };
}
