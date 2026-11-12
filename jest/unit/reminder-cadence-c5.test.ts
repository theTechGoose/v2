/**
 * REQ-704 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue m60: "Reminders: no
 * before-due option, no preview, wording disagrees with Settings".
 *
 * RCA (analyst + skeptic UPHELD, at 2444608a):
 *  - REMINDER_DAY_CHOICES / CADENCE_DAYS were post-due only ([3, 7, 14, 30]);
 *  - the invoice detail said "días 3, 7, 14, 30 después del vencimiento"
 *    (four customer reminders) while Settings — and the backend — say day 30
 *    only alerts the owner;
 *  - "Enviar recordatorio" sent with no look at what the customer gets.
 */
import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_REMINDER_DAYS,
  describeReminderCadence,
  manualReminderDay,
  REMINDER_DAY_CHOICES,
  reminderDayLabel,
  reminderSettingsOf,
  toggleReminderDay,
} from "../../shared/quote-flow/reminder-settings";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const trFor = (dict: Record<string, string>) =>
(key: string, vars: Record<string, string> = {}) =>
  (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

describe("REQ-704 reminder cadence: before due, on the due date, honest copy, a preview (demo cycle 5, m60)", () => {
  test("REQ-704 the cadence offers 3 days before due and the due date; the default stays 3/7/14/30", () => {
    expect(REMINDER_DAY_CHOICES).toEqual([-3, 0, 3, 7, 14, 30]);
    expect(DEFAULT_REMINDER_DAYS).toEqual([3, 7, 14, 30]);
    expect(reminderSettingsOf(null).days).toEqual([3, 7, 14, 30]);
    expect(
      reminderSettingsOf({ reminders: { enabled: true, days: [7, 0, -3] } })
        .days,
    ).toEqual([-3, 0, 7]);
    expect(toggleReminderDay([3, 7, 14, 30], -3, true)).toEqual([
      -3,
      3,
      7,
      14,
      30,
    ]);
  });

  test("REQ-704 the invoice detail splits out day 30: customer steps, then 'day 30 we alert you'", () => {
    expect(describeReminderCadence([3, 7, 14, 30], "Ana", trFor(en))).toBe(
      "Reminders to Ana: days 3, 7, 14 after due · day 30 we alert you",
    );
    expect(describeReminderCadence([3, 7, 14, 30], "Ana", trFor(es))).toBe(
      "Recordatorios a Ana: días 3, 7, 14 después del vencimiento · el día 30 te avisamos a ti",
    );
    expect(describeReminderCadence([-3, 0, 7], "Ana", trFor(en))).toBe(
      "Reminders to Ana: 3 days before due · on the due date · day 7 after due",
    );
    expect(describeReminderCadence([30], "Ana", trFor(en))).toBe(
      "No reminders go to Ana · day 30 we alert you",
    );
    // never "days … 30 after due" — day 30 does not message the customer
    for (const dict of [en, es]) {
      const s = describeReminderCadence([3, 7, 14, 30], "Ana", trFor(dict));
      expect(s).not.toMatch(/14, 30/);
    }
  });

  test("REQ-704 Settings labels the new chips and says day 30 only alerts you", () => {
    expect(reminderDayLabel(-3, trFor(en))).toBe("3 days before due");
    expect(reminderDayLabel(0, trFor(en))).toBe("Due date");
    expect(reminderDayLabel(7, trFor(en))).toBe("Day 7");
    expect(reminderDayLabel(30, trFor(en))).toBe("Day 30 · alerts you");
    expect(reminderDayLabel(-3, trFor(es))).toBe("3 días antes");
    expect(reminderDayLabel(0, trFor(es))).toBe("Día del vencimiento");
    expect(reminderDayLabel(30, trFor(es))).toBe("Día 30 · te avisa a ti");
    // the switch no longer says "overdue" only — before-due steps exist now
    expect(en["settings.reminders.enabled"]).not.toMatch(/overdue/i);
    expect(es["settings.reminders.enabled"]).not.toMatch(/vencidas/i);
    const src = read("front-end/islands/SettingsPage.tsx");
    expect(src).toContain("reminderDayLabel(");
  });

  test("REQ-704 a manual nudge picks the step by the due date: before due → -3, due today → 0, then 3/7/14/30", () => {
    const today = "2026-11-12";
    expect(manualReminderDay("2026-11-26", today)).toBe(-3);
    expect(manualReminderDay("2026-11-13", today)).toBe(-3);
    expect(manualReminderDay("2026-11-12", today)).toBe(0);
    expect(manualReminderDay("2026-11-10", today)).toBe(3);
    expect(manualReminderDay("2026-11-09", today)).toBe(3);
    expect(manualReminderDay("2026-11-05", today)).toBe(7);
    expect(manualReminderDay("2026-10-30", today)).toBe(14);
    expect(manualReminderDay("2026-10-01", today)).toBe(30);
    // no due date → the old gentle check-in
    expect(manualReminderDay(undefined, today)).toBe(3);
  });

  test("REQ-704 the invoice detail and card use the shared cadence copy and show a preview before sending", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toContain("describeReminderCadence(");
    expect(src).toContain("manualReminderDay(");
    expect(src).toContain("/api/cron/reminder-preview");
    expect(src).toContain('data-cy="invoice-nudge-preview"');
    // the old "const day = d <= 3 ? 3 : …" post-due-only pick is gone
    expect(src).not.toMatch(/d <= 3 \? 3/);
  });

  test("REQ-704 the new copy exists in English and Spanish", () => {
    const keys = [
      "invoicesPage.detail.reminders.on",
      "invoicesPage.detail.reminders.onAlertOnly",
      "invoicesPage.detail.reminders.stepBefore",
      "invoicesPage.detail.reminders.stepOnDue",
      "invoicesPage.detail.reminders.stepAfter",
      "invoicesPage.detail.reminders.stepAfterOne",
      "invoicesPage.detail.reminders.stepAlert",
      "invoicesPage.detail.reminders.customerFallback",
      "invoicesPage.nudge.previewTitle",
      "invoicesPage.nudge.previewAlertOnly",
      "settings.reminders.dayBefore",
      "settings.reminders.dayDue",
      "settings.reminders.dayAlert",
      "paymentReminder.tone.beforeDue",
      "paymentReminder.tone.dueToday",
      "paymentReminder.subject.beforeDue",
      "paymentReminder.subject.dueToday",
    ];
    for (const k of keys) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    }
    expect(en["invoicesPage.detail.reminders.on"]).toContain("{steps}");
    expect(es["invoicesPage.detail.reminders.on"]).toContain("{steps}");
  });
});
