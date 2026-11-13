/**
 * REQ-192 — the timeclock's HTTP client. Backend:
 * backend/src/timeclock/entrypoints/timeclock-controllers/mod.ts — the worker's clock behind
 * their pm_worker cookie, the office's timesheet behind the owner's session.
 */
import { api, type ApiOptions } from "../lib/api.ts";

export type PunchType = "in" | "out";

export interface Punch {
  id: string;
  userId: string;
  workerId: string;
  type: PunchType;
  at: string;
  source: "worker" | "manual";
  reason: string | null;
  createdAt: string;
  voided: { at: string; reason: string } | null;
}

export interface Shift {
  inPunchId: string;
  outPunchId: string | null;
  start: string;
  end: string | null;
  durationMs: number | null;
  open: boolean;
  anomaly: "missing_out" | null;
}

export interface Anomaly {
  punchId: string;
  kind: "missing_in" | "missing_out";
  at: string;
}

export interface StatusView {
  worker: { id: string; name: string };
  status: PunchType;
  since: string | null;
  shifts: Shift[];
  weekTotalMs: number;
  todayTotalMs: number;
  asOf: string;
  from: string;
  to: string;
}

export interface Report {
  from: string;
  to: string;
  asOf: string;
  workers: Array<{
    worker: { id: string; name: string };
    shifts: Shift[];
    totalMs: number;
    anomalies: Anomaly[];
  }>;
}

/** the browser's own week: Monday 00:00 local to the next Monday, and today's start */
export interface Window {
  from: string;
  to: string;
  today: string;
}

export function localWeek(
  now = new Date(),
  weeks = 0,
): Window & { monday: Date } {
  const back = (now.getDay() + 6) % 7;
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - back + weeks * 7,
  );
  const next = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 7,
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    from: monday.toISOString(),
    to: next.toISOString(),
    today: today.toISOString(),
    monday,
  };
}

export const timeclockWorker = {
  status: (w: Window) =>
    api.get<StatusView>("/timeclock/worker/status", { query: { ...w } }),
  /** no type: flip the state; a type that would not flip it is refused (409) */
  punch: (w: Window, type?: PunchType) =>
    api.post<{ punch: Punch; status: StatusView }>("/timeclock/worker/punch", {
      ...w,
      type,
    }),
};

export const timeclockClient = {
  report: (from: string, to: string, opts?: ApiOptions) =>
    api.get<Report>("/timeclock/report", { ...opts, query: { from, to } }),
  punches: (from: string, to: string, workerId?: string, opts?: ApiOptions) =>
    api.get<Punch[]>("/timeclock/punches", {
      ...opts,
      query: { from, to, workerId },
    }),
  manual: (
    b: { workerId: string; type: PunchType; at: string; reason: string },
    opts?: ApiOptions,
  ) => api.post<Punch>("/timeclock/punches", b, opts),
  /** a whole forgotten shift: an in and an out in one go, in a gap between existing punches */
  shift: (
    b: { workerId: string; start: string; end: string; reason: string },
    opts?: ApiOptions,
  ) => api.post<{ in: Punch; out: Punch }>("/timeclock/shifts", b, opts),
  void: (id: string, reason: string, opts?: ApiOptions) =>
    api.post<Punch>(`/timeclock/punches/${id}/void`, { reason }, opts),
};

/** "3h 05m" */
export function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
