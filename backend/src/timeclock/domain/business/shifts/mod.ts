/**
 * REQ-192 — the timeclock's pure rules: no I/O, no clock — everything is passed in. Ported from
 * the Mallard Group timeclock (src/domain/punches.ts), minus device flags.
 */
import type { Anomaly, PunchType, Shift } from "@timeclock/dto/timeclock.ts";

export interface PunchLike {
  id: string;
  type: PunchType;
  at: string;
}

export type FlipRejection = "already_in" | "not_in";
export type ManualRejection =
  | "same_as_prev"
  | "same_as_next"
  | "out_without_in";

const ms = (iso: string) => new Date(iso).getTime();

/** current state from the ordered punch list: the last punch wins */
export function lastStatus(
  punches: PunchLike[],
): { status: PunchType; since: string | null } {
  const last = punches.at(-1);
  return last
    ? { status: last.type, since: last.at }
    : { status: "out", since: null };
}

/** a worker's punch must flip the current state */
export function checkFlip(
  last: PunchLike | null,
  type: PunchType,
): FlipRejection | null {
  const current = last?.type ?? "out";
  if (type === "in") return current === "in" ? "already_in" : null;
  return current === "in" ? null : "not_in";
}

/**
 * a manual punch goes between two neighbours (either may be absent) and must alternate with
 * both: never the same type as the punch before or after it, and an "out" needs an "in" before it
 */
export function checkManualPunch(
  prev: PunchLike | null,
  next: PunchLike | null,
  type: PunchType,
): ManualRejection | null {
  if (type === "in") {
    if (prev?.type === "in") return "same_as_prev";
    if (next?.type === "in") return "same_as_next";
    return null;
  }
  if (!prev) return "out_without_in";
  if (prev.type === "out") return "same_as_prev";
  if (next?.type === "out") return "same_as_next";
  return null;
}

/** pair punches into shifts; out-of-order sequences (which voids create) become anomalies, never guesses */
export function deriveShifts(
  punches: PunchLike[],
  now: string,
): { shifts: Shift[]; anomalies: Anomaly[] } {
  const shifts: Shift[] = [];
  const anomalies: Anomaly[] = [];
  let open: PunchLike | null = null;
  for (const p of punches) {
    if (p.type === "in") {
      if (open) {
        shifts.push({
          inPunchId: open.id,
          outPunchId: null,
          start: open.at,
          end: null,
          durationMs: null,
          open: false,
          anomaly: "missing_out",
        });
        anomalies.push({ punchId: open.id, kind: "missing_out", at: open.at });
      }
      open = p;
    } else if (open) {
      shifts.push({
        inPunchId: open.id,
        outPunchId: p.id,
        start: open.at,
        end: p.at,
        durationMs: ms(p.at) - ms(open.at),
        open: false,
        anomaly: null,
      });
      open = null;
    } else {
      anomalies.push({ punchId: p.id, kind: "missing_in", at: p.at });
    }
  }
  if (open) {
    shifts.push({
      inPunchId: open.id,
      outPunchId: null,
      start: open.at,
      end: null,
      durationMs: Math.max(0, ms(now) - ms(open.at)),
      open: true,
      anomaly: null,
    });
  }
  return { shifts, anomalies };
}

/** total worked time; unclosed anomalies contribute nothing */
export function sumShifts(shifts: Shift[]): number {
  return shifts.reduce((total, s) => total + (s.durationMs ?? 0), 0);
}

// ---------------------------------------------------------------- weeks in a time zone

/** the zone's offset from UTC, in ms, at an instant */
function offsetAt(tz: string, instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** the instant at which the civil date `y-m-d` starts in the zone */
function zonedMidnight(tz: string, y: number, m: number, d: number): number {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetAt(tz, guess);
  t = guess - offsetAt(tz, t); // once more for an offset that changed between the guess and the answer
  return t;
}

/** the zone's civil date of an instant, as [y, m, d] and the weekday (0 = Sunday) */
function civil(
  tz: string,
  now: Date,
): { y: number; m: number; d: number; wd: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    get("weekday"),
  );
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    wd,
  };
}

/** the start of the zone's day holding `now` */
export function dayStartIn(tz: string, now: Date = new Date()): string {
  const c = civil(tz, now);
  return new Date(zonedMidnight(tz, c.y, c.m, c.d)).toISOString();
}

/** Monday 00:00 to the next Monday 00:00 in the zone, around `now` */
export function weekBoundsIn(
  tz: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const c = civil(tz, now);
  const back = (c.wd + 6) % 7; // days since Monday
  const from = zonedMidnight(tz, c.y, c.m, c.d - back);
  // the next Monday by civil arithmetic: Date.UTC normalises the overflow
  const n = new Date(Date.UTC(c.y, c.m - 1, c.d - back + 7));
  const to = zonedMidnight(
    tz,
    n.getUTCFullYear(),
    n.getUTCMonth() + 1,
    n.getUTCDate(),
  );
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export const timeclockTz = () =>
  Deno.env.get("FIELD_TZ")?.trim() || "America/New_York";
