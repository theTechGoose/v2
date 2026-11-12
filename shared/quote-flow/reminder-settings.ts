/**
 * REQ-623 (demo cycle 4, M26) — the business's payment-reminder setting.
 *
 * `BusinessIdentity.reminders = { enabled, days }` turns the overdue cadence
 * on or off for every invoice and picks which steps run (days past the due
 * date). Unset → on, at day 3 / 7 / 14 / 30 (the roadmap §E cadence). The
 * per-invoice `remindersMuted` flag still silences one invoice on top of it.
 *
 * Read by the backend sweep (SendPaymentReminder), the Settings card and the
 * invoice detail, so all three agree on the defaults.
 */

/** The cadence steps a business can pick from (days past due). */
export const REMINDER_DAY_CHOICES = [3, 7, 14, 30] as const;
export type ReminderDay = typeof REMINDER_DAY_CHOICES[number];

/** Unset → every step. */
export const DEFAULT_REMINDER_DAYS: readonly ReminderDay[] =
  REMINDER_DAY_CHOICES;

export interface ReminderSettings {
  enabled: boolean;
  days: ReminderDay[];
}

export function isReminderDay(n: unknown): n is ReminderDay {
  return (REMINDER_DAY_CHOICES as readonly unknown[]).includes(n);
}

/** Known days only, in cadence order, once each. */
function normalizeDays(days: unknown): ReminderDay[] {
  if (!Array.isArray(days)) return [];
  return REMINDER_DAY_CHOICES.filter((d) => days.includes(d));
}

/** The effective setting for a business identity (null/unset → on, 3/7/14/30). */
export function reminderSettingsOf(
  identity?: { reminders?: unknown } | null,
): ReminderSettings {
  const r = identity?.reminders as
    | { enabled?: unknown; days?: unknown }
    | null
    | undefined;
  const days = normalizeDays(r?.days);
  return {
    enabled: r?.enabled !== false,
    days: days.length ? days : [...DEFAULT_REMINDER_DAYS],
  };
}

/** True when `day` is the only step left — its chip can't be turned off. */
export function isLastReminderDay(
  days: readonly number[],
  day: number,
): boolean {
  return days.length === 1 && days[0] === day;
}

/** The next cadence after a chip tap, in cadence order; null when it would empty the list. */
export function toggleReminderDay(
  days: readonly number[],
  day: ReminderDay,
  on: boolean,
): ReminderDay[] | null {
  const set = new Set(normalizeDays(days));
  if (on) set.add(day);
  else set.delete(day);
  if (set.size === 0) return null;
  return REMINDER_DAY_CHOICES.filter((d) => set.has(d));
}

/** Statuses the automatic reminders run on (a `claimed` invoice is paused, REQ-250). */
export const REMINDER_ELIGIBLE_STATUSES: readonly string[] = ["sent", "viewed"];

/**
 * What the invoice detail says about automatic reminders for one invoice:
 *  - "none"  — not an open sent invoice (draft, paid, void, claimed…): no row
 *  - "muted" — this invoice is muted
 *  - "off"   — reminders are off for the whole business (Settings)
 *  - "on"    — reminders will run at the business's cadence
 */
export type InvoiceReminderState = "none" | "muted" | "off" | "on";

export function invoiceReminderState(
  invoice: { status?: string; remindersMuted?: boolean },
  settings: ReminderSettings,
): InvoiceReminderState {
  if (!REMINDER_ELIGIBLE_STATUSES.includes(invoice.status ?? "")) return "none";
  if (invoice.remindersMuted) return "muted";
  if (!settings.enabled) return "off";
  return "on";
}
