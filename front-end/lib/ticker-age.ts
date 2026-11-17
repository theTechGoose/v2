/**
 * REQ-273 (demo i18n-formatting-m10) — the age shown on the topbar's
 * live-activity pill. Returned as a dictionary key (+ the compact time) so the
 * island renders it in the live language:
 *   under a minute (or a timestamp slightly ahead, clock skew) → "just now"
 *   then whole minutes, hours, days                            → "{time} ago"
 * It used to clamp every age to at least "1m", so an event 0-119 s old read
 * "1m" for two minutes and a fresh one never said "just now".
 */
export type TickerAge =
  | { key: "dashTopbar.justNow" }
  | { key: "dashTopbar.timeAgo"; time: string };

export function tickerAge(iso: string, nowMs = Date.now()): TickerAge | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const m = Math.floor((nowMs - t) / 60_000);
  if (m < 1) return { key: "dashTopbar.justNow" };
  if (m < 60) return { key: "dashTopbar.timeAgo", time: `${m}m` };
  const h = Math.floor(m / 60);
  if (h < 24) return { key: "dashTopbar.timeAgo", time: `${h}h` };
  return { key: "dashTopbar.timeAgo", time: `${Math.floor(h / 24)}d` };
}
