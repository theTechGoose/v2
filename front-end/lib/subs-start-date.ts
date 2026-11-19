/**
 * REQ-157 / REQ-139 / REQ-787 — the New / Edit repeat visit form's day picks
 * and how they follow the First visit date. Pulled out of
 * islands/FieldSubscriptionsPage.tsx (verbatim) so the rule can be unit-tested
 * (LOOP-007 q3-97).
 */

/** REQ-157 — the day of the month of a date, today's when it is not one */
export function monthDayOf(iso: string): number {
  const d = Number(iso.slice(8, 10));
  return Number.isInteger(d) && d >= 1 && d <= 31 ? d : new Date().getDate();
}

/** REQ-787 — the month of a date (1–12), today's when it is not one */
export function monthOf(iso: string): number {
  const m = Number(iso.slice(5, 7));
  return Number.isInteger(m) && m >= 1 && m <= 12
    ? m
    : new Date().getMonth() + 1;
}

/** weekday (0 = Sunday) of a date, today's when it is not one */
export function weekdayOf(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().getDay() : d.getDay();
}

/** the slice of the form the First visit date drives */
export interface StartDatePicks {
  startDate: string;
  days: number[];
  daysOfMonth: number[];
  month: number;
  /** REQ-1166 — the weekday chips were picked by hand (or saved on the visit) */
  daysTouched?: boolean;
  /** REQ-1166 — the day-of-month chips / annual month were picked by hand (or saved) */
  domTouched?: boolean;
}

/** a blank form's picks, seeded from its First visit date — nothing touched yet */
export function seedPicks(startDate: string): StartDatePicks {
  return {
    startDate,
    days: [weekdayOf(startDate)],
    daysOfMonth: [monthDayOf(startDate)],
    month: monthOf(startDate),
    daysTouched: false,
    domTouched: false,
  };
}

/**
 * REQ-1166 (amends REQ-157 / REQ-139 / REQ-787) — the form after the First
 * visit date is typed. Picks the user never touched were only seeded from the
 * date the form opened on, so they follow the typed date (weekday, day of the
 * month and, for annual, the month). Picks the user chose survive; an emptied
 * list is refilled from the typed date.
 */
export function withStartDate<F extends StartDatePicks>(f: F, v: string): F {
  const days = !f.daysTouched || !f.days.length ? [weekdayOf(v)] : f.days;
  const followDom = !f.domTouched;
  return {
    ...f,
    startDate: v,
    days,
    daysOfMonth: followDom || !f.daysOfMonth.length
      ? [monthDayOf(v)]
      : f.daysOfMonth,
    month: followDom ? monthOf(v) : f.month,
  };
}
