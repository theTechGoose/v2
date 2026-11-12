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
 *
 * REQ-704 (demo cycle 5, m60): the cadence also offers -3 (three days BEFORE
 * the due date) and 0 (ON the due date). Day 30 never messages the customer —
 * it only alerts the owner — and every place that lists the cadence says so.
 */

/** The cadence steps a business can pick from, in days relative to the due
 *  date: -3 = three days before, 0 = the due date, 3+ = days past due. */
export const REMINDER_DAY_CHOICES = [-3, 0, 3, 7, 14, 30] as const;
export type ReminderDay = typeof REMINDER_DAY_CHOICES[number];

/** The last step: it alerts the owner only, never the customer. */
export const REMINDER_ALERT_DAY = 30;

/** Unset → the post-due steps 3 / 7 / 14 / 30 (before-due steps are opt-in). */
export const DEFAULT_REMINDER_DAYS: readonly ReminderDay[] = [3, 7, 14, 30];

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

/** A translator: a lang key + vars → the string (tFor(lang, …) / t(lang, …)). */
export type ReminderTr = (key: string, vars?: Record<string, string>) => string;

/** REQ-704: a Settings chip's label — "3 days before due", "Due date",
 *  "Day 7", "Day 30 · alerts you". */
export function reminderDayLabel(day: number, tr: ReminderTr): string {
  if (day < 0) return tr("settings.reminders.dayBefore");
  if (day === 0) return tr("settings.reminders.dayDue");
  if (day === REMINDER_ALERT_DAY) {
    return tr("settings.reminders.dayAlert", { n: String(day) });
  }
  return tr("settings.reminders.day", { n: String(day) });
}

/**
 * REQ-704: the invoice detail's one line about the cadence. The customer's
 * steps first, then day 30 split out — it alerts the owner only:
 *   "Reminders to Ana: days 3, 7, 14 after due · day 30 we alert you"
 */
export function describeReminderCadence(
  days: readonly number[],
  name: string,
  tr: ReminderTr,
): string {
  const picked = REMINDER_DAY_CHOICES.filter((d) => days.includes(d));
  const after = picked.filter((d) => d > 0 && d !== REMINDER_ALERT_DAY);
  const steps: string[] = [];
  if (picked.some((d) => d < 0)) {
    steps.push(tr("invoicesPage.detail.reminders.stepBefore"));
  }
  if (picked.includes(0)) {
    steps.push(tr("invoicesPage.detail.reminders.stepOnDue"));
  }
  if (after.length) {
    steps.push(
      tr(
        after.length === 1
          ? "invoicesPage.detail.reminders.stepAfterOne"
          : "invoicesPage.detail.reminders.stepAfter",
        { days: after.join(", ") },
      ),
    );
  }
  const alert = picked.includes(REMINDER_ALERT_DAY);
  if (!steps.length) {
    return alert
      ? tr("invoicesPage.detail.reminders.onAlertOnly", { name })
      : tr("invoicesPage.detail.reminders.on", { name, steps: "" });
  }
  if (alert) steps.push(tr("invoicesPage.detail.reminders.stepAlert"));
  return tr("invoicesPage.detail.reminders.on", {
    name,
    steps: steps.join(" · "),
  });
}

/** Whole calendar days from `dueDate` to `todayIso` (both YYYY-MM-DD):
 *  negative before the due date, 0 on it, positive after. null when either
 *  is missing or unreadable. */
export function daysFromDue(
  dueDate: string | undefined | null,
  todayIso: string,
): number | null {
  const parse = (s: string | undefined | null) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  };
  const due = parse(dueDate);
  const today = parse(todayIso);
  if (!Number.isFinite(due) || !Number.isFinite(today)) return null;
  return Math.round((today - due) / 86_400_000);
}

/** REQ-704: the step a manual "Send a nudge" uses, by where the invoice
 *  stands against its due date — before it → -3, on it → 0, then the
 *  post-due rung (3 / 7 / 14 / 30). No due date → the gentle day-3 copy. */
export function manualReminderDay(
  dueDate: string | undefined | null,
  todayIso: string,
): ReminderDay {
  const d = daysFromDue(dueDate, todayIso);
  if (d == null) return 3;
  if (d < 0) return -3;
  if (d === 0) return 0;
  return d <= 3 ? 3 : d <= 7 ? 7 : d <= 14 ? 14 : 30;
}
