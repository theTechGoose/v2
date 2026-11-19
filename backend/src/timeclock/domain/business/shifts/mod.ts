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

// REQ-1038 — one copy, shared with the browser's timeclock (clients/timeclock.ts)
export {
  dayStartIn,
  weekBoundsIn,
} from "../../../../../../shared/field/zoned-time.ts";

/** the server's fallback zone — an account's week uses `businessZoneOf(userId)` (REQ-940) */
export const timeclockTz = () =>
  Deno.env.get("FIELD_TZ")?.trim() || "America/New_York";
