/**
 * REQ-929 — sign out after inactivity. One rule for the backend's PUT /me validation, the
 * Settings picker and the app shell's timer.
 */

/** minutes; 0 is Never (and the default — an unset record is Never) */
export const IDLE_LOGOUT_CHOICES = [0, 15, 30, 60, 120, 240] as const;
export type IdleLogoutMinutes = typeof IDLE_LOGOUT_CHOICES[number];

/** the banner shows for the last minute */
export const IDLE_WARN_MS = 60_000;

/** localStorage key every tab of this browser stamps on activity, so one busy tab keeps all alive */
export const IDLE_LAST_KEY = "pm:idle-last";

export function isIdleLogoutMinutes(v: unknown): v is IdleLogoutMinutes {
  return typeof v === "number" &&
    (IDLE_LOGOUT_CHOICES as readonly number[]).includes(v);
}

/** the person's own setting: the actor's while acting (never the owner's); unset/bad → 0 */
export function idleMinutesOf(
  u?: {
    idleLogoutMinutes?: unknown;
    actor?: { idleLogoutMinutes?: unknown } | null;
  } | null,
): number {
  if (!u) return 0;
  const v = u.actor ? u.actor.idleLogoutMinutes : u.idleLogoutMinutes;
  return isIdleLogoutMinutes(v) ? v : 0;
}

export type IdlePhase = "off" | "active" | "warn" | "expired";

export function idlePhase(
  o: { minutes: number; lastActivity: number; now: number },
): { phase: IdlePhase; remainingMs: number } {
  if (!(o.minutes > 0)) return { phase: "off", remainingMs: Infinity };
  const remainingMs = Math.max(0, o.lastActivity + o.minutes * 60_000 - o.now);
  if (remainingMs <= 0) return { phase: "expired", remainingMs: 0 };
  if (remainingMs <= IDLE_WARN_MS) return { phase: "warn", remainingMs };
  return { phase: "active", remainingMs };
}

/** "0:59" — whole seconds rounded up, so the banner never reads 0:00 while still signed in */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function parseLastActivity(
  raw: string | null | undefined,
): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && raw.trim() !== "" ? n : null;
}

/** window event Settings fires after a save, so the shell's timer follows without a reload */
export const IDLE_MINUTES_EVENT = "pm:idle-minutes";
