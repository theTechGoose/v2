/**
 * Server-side relative-time formatter. Pure function so coordinators can
 * embed it in their derived projections without dragging in a date lib.
 *
 *   "just now"     — < 1 minute
 *   "Nm ago"       — < 1 hour
 *   "Nh ago"       — < 24 hours
 *   "N day(s) ago" — < 7 days
 *   "N week(s) ago"— < 30 days
 *   "N month(s) ago" — < 365 days
 *   "N year(s) ago"  — otherwise
 */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const ms = now.getTime() - then;
  if (ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return day === 1 ? "1 day ago" : `${day} days ago`;
  if (day < 30) {
    const w = Math.floor(day / 7);
    return w === 1 ? "1 week ago" : `${w} weeks ago`;
  }
  if (day < 365) {
    const m = Math.floor(day / 30);
    return m === 1 ? "1 month ago" : `${m} months ago`;
  }
  const y = Math.floor(day / 365);
  return y === 1 ? "1 year ago" : `${y} years ago`;
}
