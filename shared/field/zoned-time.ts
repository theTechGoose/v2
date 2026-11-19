/**
 * REQ-940 / REQ-1038 — wall time in a named IANA zone, with no device clock involved: the
 * business's day and week (Monday 00:00 → next Monday 00:00), and a datetime-local value read
 * and written in that zone. One copy for the backend's timeclock (weekBoundsIn / dayStartIn)
 * and the browser's (clients/timeclock.ts localWeek, the timesheet's Add-punch fields).
 */

/** the zone's wall clock at an instant */
function wallOf(
  tz: string,
  instant: number,
): {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
  wd: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")) % 24,
    min: Number(get("minute")),
    s: Number(get("second")),
    wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      get("weekday"),
    ),
  };
}

/** the zone's offset from UTC, in ms, at an instant */
function offsetAt(tz: string, instant: number): number {
  const w = wallOf(tz, instant);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** the instant at which the zone's wall clock reads `y-m-d h:min` (day/month overflow normalises) */
export function zonedWallToInstant(
  tz: string,
  y: number,
  m: number,
  d: number,
  h = 0,
  min = 0,
): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - offsetAt(tz, guess);
  t = guess - offsetAt(tz, t); // once more for an offset that changed between the guess and the answer
  return t;
}

/** the start of the zone's day holding `now` */
export function dayStartIn(tz: string, now: Date = new Date()): string {
  const c = wallOf(tz, now.getTime());
  return new Date(zonedWallToInstant(tz, c.y, c.m, c.d)).toISOString();
}

/** Monday 00:00 to the next Monday 00:00 in the zone, around `now`, `weeks` weeks away */
export function weekBoundsIn(
  tz: string,
  now: Date = new Date(),
  weeks = 0,
): { from: string; to: string } {
  const c = wallOf(tz, now.getTime());
  const back = (c.wd + 6) % 7; // days since Monday
  const start = c.d - back + weeks * 7;
  return {
    from: new Date(zonedWallToInstant(tz, c.y, c.m, start)).toISOString(),
    to: new Date(zonedWallToInstant(tz, c.y, c.m, start + 7)).toISOString(),
  };
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** a datetime-local value ("YYYY-MM-DDTHH:mm") for an instant, on the zone's wall clock */
export function toZonedInput(d: Date, tz: string): string {
  const w = wallOf(tz, d.getTime());
  return `${w.y}-${p2(w.m)}-${p2(w.d)}T${p2(w.h)}:${p2(w.min)}`;
}

/** the instant a datetime-local value names on the zone's wall clock; null when unreadable */
export function fromZonedInput(v: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const t = zonedWallToInstant(tz, +m[1], +m[2], +m[3], +m[4], +m[5]);
  return Number.isNaN(t) ? null : new Date(t);
}
