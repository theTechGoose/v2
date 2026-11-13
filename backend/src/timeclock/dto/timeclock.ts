/**
 * REQ-192 — the timeclock's records and views. A punch is an immutable event: a worker of an
 * account went "in" or "out" at a moment. Everything else (status, shifts, totals) is derived
 * from the worker's ordered, non-voided punches. A void is a correction appended to the punch.
 */
export type PunchType = "in" | "out";

export interface Punch {
  id: string;
  /** the account */
  userId: string;
  workerId: string;
  type: PunchType;
  /** ISO-8601 UTC — the server's clock for a worker's punch, the office's time for a manual one */
  at: string;
  source: "worker" | "manual";
  /** the office's reason on a manual punch; null on a worker's */
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
  /** true only for the trailing, still-running shift */
  open: boolean;
  /** an "in" that was followed by another "in" — never closed */
  anomaly: "missing_out" | null;
}

export interface Anomaly {
  punchId: string;
  kind: "missing_in" | "missing_out";
  at: string;
}

export interface WorkerRef {
  id: string;
  name: string;
}

/** the worker's screen: state, the week's shifts, both totals */
export interface StatusView {
  worker: WorkerRef;
  status: PunchType;
  since: string | null;
  shifts: Shift[];
  weekTotalMs: number;
  todayTotalMs: number;
  asOf: string;
  from: string;
  to: string;
}

export interface PunchResult {
  punch: Punch;
  status: StatusView;
}

/** the office's week */
export interface Report {
  from: string;
  to: string;
  asOf: string;
  workers: Array<{
    worker: WorkerRef;
    shifts: Shift[];
    totalMs: number;
    anomalies: Anomaly[];
  }>;
}

export class TimeclockError extends Error {
  constructor(
    /** a stable code the client can switch on: already_in, not_in, same_as_prev, … */
    readonly code: string,
    readonly status = 400,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "TimeclockError";
  }
}
