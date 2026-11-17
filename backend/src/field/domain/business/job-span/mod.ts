/**
 * REQ-785 — a job of several days (demo-loop dv1-d11; Raphael: "Yes, multi-day jobs."). It is
 * ONE one-off task (REQ-164) with a last day (`endDate`) and, optionally, more workers
 * (`crewIds`). It covers every day from its `date` to its `endDate`, shows on each of them, and
 * is done once. Pure.
 */
import type { FieldTask } from "@field/dto/field.ts";
import { isValidDate, shiftDate } from "@field/domain/business/schedule/mod.ts";

/** the longest job, in days */
export const MAX_JOB_DAYS = 31;

type Span = Pick<FieldTask, "date" | "endDate">;

/** the last day a task covers: a job's endDate, else its own day */
export const lastDayOf = (t: Span): string =>
  t.endDate && t.endDate > t.date ? t.endDate : t.date;

/** does the task show on `day`? */
export const covers = (t: Span, day: string): boolean =>
  t.date <= day && day <= lastDayOf(t);

/** how many days it runs — 1 for a one-day task */
export const jobDays = (t: Span): number =>
  Math.round(
    (Date.parse(lastDayOf(t) + "T00:00:00Z") -
      Date.parse(t.date + "T00:00:00Z")) / 86_400_000,
  ) + 1;

/** every day it covers, first to last — never more than MAX_JOB_DAYS, so a bad record cannot fan out */
export function daysCovered(t: Span): string[] {
  const last = lastDayOf(t);
  const out = [t.date];
  while (out.length < MAX_JOB_DAYS && out[out.length - 1] < last) {
    out.push(shiftDate(out[out.length - 1], 1));
  }
  return out;
}

export type SpanResult =
  | { ok: true; endDate?: string }
  | {
    ok: false;
    error: string;
    code: "bad_end_date" | "bad_days" | "end_before_start" | "job_too_long";
  };

const given = (v: unknown) => v !== undefined && v !== null && v !== "";

/**
 * the job's last day from what the office sent with its first day: `endDate` (YYYY-MM-DD) or a
 * number of `days` (1–31); `endDate` wins when both come. Nothing, a blank, null or the first day
 * itself is a one-day task (no endDate).
 */
export function spanFrom(
  date: string,
  b: { endDate?: unknown; days?: unknown },
): SpanResult {
  let end: string | undefined;
  if (given(b.endDate)) {
    if (!isValidDate(b.endDate)) {
      return {
        ok: false,
        error: "endDate must be YYYY-MM-DD",
        code: "bad_end_date",
      };
    }
    end = b.endDate;
  } else if (given(b.days)) {
    const n = Number(b.days);
    if (!Number.isInteger(n) || n < 1 || n > MAX_JOB_DAYS) {
      return {
        ok: false,
        error: `days must be 1–${MAX_JOB_DAYS}`,
        code: "bad_days",
      };
    }
    end = shiftDate(date, n - 1);
  }
  if (!end || end === date) return { ok: true };
  if (end < date) {
    return {
      ok: false,
      error: "endDate is before date",
      code: "end_before_start",
    };
  }
  if (jobDays({ date, endDate: end }) > MAX_JOB_DAYS) {
    return {
      ok: false,
      error: `a job runs at most ${MAX_JOB_DAYS} days`,
      code: "job_too_long",
    };
  }
  return { ok: true, endDate: end };
}

/** is this worker on the task — its worker, or one of its crew? */
export const onTask = (
  workerId: string,
  t: Pick<FieldTask, "workerId" | "crewIds">,
): boolean => t.workerId === workerId || !!t.crewIds?.includes(workerId);

/** the crew as sent: unique worker ids, never the lead; [] for none; null when it is not a list of ids */
export function crewList(raw: unknown, leadId: string): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string" || !x.trim()) return null;
    const id = x.trim();
    if (id !== leadId && !out.includes(id)) out.push(id);
  }
  return out;
}

/** the task led by `workerId` — who is then no longer also on its crew */
export function ledBy(t: FieldTask, workerId: string): FieldTask {
  const { crewIds: _c, ...rest } = t;
  const crewIds = t.crewIds?.filter((x) => x !== workerId) ?? [];
  return { ...rest, workerId, ...(crewIds.length ? { crewIds } : {}) };
}
