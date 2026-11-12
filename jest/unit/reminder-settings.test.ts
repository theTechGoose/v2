/**
 * REQ-623 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M26: "No payment-reminder settings
 * (cadence/on-off)" — Settings had no reminder cadence or on/off switch; the
 * only reminder control was on an invoice card.
 *
 * RCA (M26): the cadence was hard-coded to day 3/7/14/30 in
 * SendPaymentReminder (pickNextDay); the only switch was the per-invoice
 * remindersMuted flag. The business-level setting now lives on
 * BusinessIdentity.reminders = { enabled, days }, read through
 * shared/quote-flow/reminder-settings.ts by the backend sweep, the Settings
 * card and the invoice detail.
 */
import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_REMINDER_DAYS,
  invoiceReminderState,
  isLastReminderDay,
  REMINDER_DAY_CHOICES,
  reminderSettingsOf,
  toggleReminderDay,
} from "../../shared/quote-flow/reminder-settings";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-623 payment-reminder settings (demo cycle 4, M26)", () => {
  test("REQ-623 unset → reminders on at day 3/7/14/30", () => {
    expect(REMINDER_DAY_CHOICES).toEqual([3, 7, 14, 30]);
    expect(DEFAULT_REMINDER_DAYS).toEqual([3, 7, 14, 30]);
    expect(reminderSettingsOf(null)).toEqual({
      enabled: true,
      days: [3, 7, 14, 30],
    });
    expect(reminderSettingsOf({})).toEqual({
      enabled: true,
      days: [3, 7, 14, 30],
    });
  });

  test("REQ-623 a saved setting is read back sorted, de-duplicated, known days only", () => {
    expect(reminderSettingsOf({ reminders: { enabled: false, days: [7] } }))
      .toEqual({ enabled: false, days: [7] });
    expect(
      reminderSettingsOf({ reminders: { enabled: true, days: [30, 3, 3, 5] } }),
    ).toEqual({ enabled: true, days: [3, 30] });
    // an empty or junk list falls back to the default cadence
    expect(reminderSettingsOf({ reminders: { enabled: true, days: [] } }))
      .toEqual({ enabled: true, days: [3, 7, 14, 30] });
    // enabled missing → on
    expect(reminderSettingsOf({ reminders: { days: [14] } })).toEqual({
      enabled: true,
      days: [14],
    });
  });

  test("REQ-623 toggling a cadence chip keeps the order and never empties the list", () => {
    expect(toggleReminderDay([3, 7, 14, 30], 7, false)).toEqual([3, 14, 30]);
    expect(toggleReminderDay([3, 30], 14, true)).toEqual([3, 14, 30]);
    expect(toggleReminderDay([14], 14, false)).toBeNull();
    expect(isLastReminderDay([14], 14)).toBe(true);
    expect(isLastReminderDay([3, 14], 14)).toBe(false);
  });

  test("REQ-623 the invoice detail's reminder state: muted, off for the business, on, or n/a", () => {
    const on = { enabled: true, days: [3, 7] as (3 | 7 | 14 | 30)[] };
    const off = { enabled: false, days: [3, 7] as (3 | 7 | 14 | 30)[] };
    expect(invoiceReminderState({ status: "sent" }, on)).toBe("on");
    expect(invoiceReminderState({ status: "viewed" }, on)).toBe("on");
    expect(invoiceReminderState({ status: "sent", remindersMuted: true }, on))
      .toBe("muted");
    expect(invoiceReminderState({ status: "sent" }, off)).toBe("off");
    expect(invoiceReminderState({ status: "paid" }, on)).toBe("none");
    expect(invoiceReminderState({ status: "draft" }, on)).toBe("none");
  });

  test("REQ-623 Settings draws a reminders card with an on/off switch and cadence chips that save reminders", () => {
    const src = read("front-end/islands/SettingsPage.tsx");
    expect(src).toContain("RemindersEditCard");
    expect(src).toContain('dataCy="settings-reminders"'); // EditPanel stamps data-cy
    expect(src).toContain('data-cy="settings-reminders-enabled"');
    expect(src).toContain("data-cy={`settings-reminders-day-${d}`}");
    expect(src).toContain("toggleReminderDay(");
    expect(src).toContain("reminderSettingsOf(");
    expect(src).toMatch(/updateIdentity\(\{\s*reminders/);
  });

  test("REQ-623 the invoice detail shows the reminder state and the per-invoice mute", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toContain('data-cy="invoice-detail-reminders"');
    expect(src).toContain('data-cy="invoice-detail-mute"');
    expect(src).toContain("invoiceReminderState(");
  });

  test("REQ-623 the reminder copy exists in English and Spanish", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    const keys = [
      "settings.reminders.title",
      "settings.reminders.enabled",
      "settings.reminders.hint",
      "settings.reminders.days",
      "settings.reminders.day",
      "settings.reminders.keepOne",
      "settings.reminders.offNote",
      "invoicesPage.detail.reminders.on",
      "invoicesPage.detail.reminders.off",
      "invoicesPage.detail.reminders.muted",
      "invoicesPage.detail.reminders.mute",
      "invoicesPage.detail.reminders.unmute",
    ];
    for (const k of keys) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    }
    expect(en["settings.reminders.title"]).toMatch(/reminder/i);
    expect(es["settings.reminders.title"]).toMatch(/recordatorio/i);
    expect(en["settings.reminders.day"]).toContain("{n}");
    expect(es["settings.reminders.day"]).toContain("{n}");
    expect(en["invoicesPage.detail.reminders.on"]).toContain("{days}");
    expect(es["invoicesPage.detail.reminders.on"]).toContain("{days}");
  });
});
