/**
 * REQ-356 (demo-loop cycle 1, m8) — what pressing a plan card on the onboarding wizard does, said
 * on the card before it is pressed: a card IS the pick (a form posting /plan/pick, 303 to the
 * pay page), so the line under it (REQ-127's `note`) is the confirmation. A paid card names the
 * amount billed today, the monthly price after it, and that a secure payment page comes next;
 * the free card says nothing is paid. The amounts come from the one switch rule
 * (shared/quote-flow/plan-switch.ts) — the same rule the backend charges by.
 *
 * REQ-615 (demo-loop cycle 4, m4) — a first pick is TWO charges before the steady monthly one
 * (REQ-129, `anchoredSchedule`): the full month today, paid through a month later; then on the
 * next 1st a prorated bill for the days of that month past the paid-through date. "Prorated on
 * the 1st" without an amount or a date read as describing today's charge, so the note states each
 * charge with its date and the days it covers.
 *
 * REQ-725 (demo-loop cycle 5, m3) — spelled out on every card, that dated schedule read as a
 * double charge. A wizard card now says one plain line ("$99 today, then $99 on the 1st of each
 * month"); the dated schedule moves under the cards into a "How billing works" disclosure
 * (`wizardBillingHow`), worked for one plan from the same `anchoredSchedule`.
 */
import {
  anchoredSchedule,
  planById,
  type SwitchCurrent,
  switchQuote,
} from "../../shared/quote-flow/plan-switch.ts";
import { dollars } from "../components/PlanCards.tsx";
import type { Lang } from "./lang.ts";

type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export function wizardPlanNote(
  t: Translate,
  current: SwitchCurrent | null | undefined,
  targetId: string,
  now: string,
  _lang: Lang = "en", // REQ-725: the one-line note carries no dates
): string | null {
  const q = switchQuote(current, targetId, now);
  if (q.kind === "free") return t("welcome.plan.note.free");
  if (q.kind === "same") return null;
  return t("welcome.plan.note.paid", {
    due: dollars(q.dueCents),
    monthly: dollars(q.monthlyCents),
  });
}

/** REQ-725 — the body of the wizard's "How billing works": a first pick of `planId` at `now`,
 *  each charge with its date, from the one anchored schedule */
export function wizardBillingHow(
  t: Translate,
  planId: string,
  now: string,
  lang: Lang = "en",
): string {
  const p = planById(planId);
  return firstPickNote(
    t,
    "welcome.plan.billingHow.body",
    p.priceCents,
    now,
    lang,
    {
      plan: p.name,
    },
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** to the cent when there are cents ($63.87), whole dollars otherwise ($99) — the prorated bill is
 *  charged to the cent, so the note never rounds it */
function money(cents: number): string {
  return cents % 100 === 0 ? dollars(cents) : `$${(cents / 100).toFixed(2)}`;
}

/** "Nov 12" / "12 nov" — in UTC, the calendar the schedule is computed in */
function day(iso: string | number, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** REQ-615 — a first pick at `now`, each charge with its date, from the one anchored schedule:
 *  {monthly} today covers {from}–{to}; {billDate} bills {prorated} for {proFrom}–{proTo}; then
 *  {monthly} every 1st. `extra` fills any other placeholder the key carries. */
export function firstPickNote(
  t: Translate,
  key: string,
  monthlyCents: number,
  now: string,
  lang: Lang,
  extra: Record<string, string | number> = {},
): string {
  const s = anchoredSchedule(now, monthlyCents);
  const paidThrough = new Date(s.paidThrough);
  const endOfThatMonth = Date.UTC(
    paidThrough.getUTCFullYear(),
    paidThrough.getUTCMonth() + 1,
    0,
  );
  return t(key, {
    monthly: dollars(monthlyCents),
    from: day(now, lang),
    to: day(paidThrough.getTime() - DAY_MS, lang),
    billDate: day(s.firstBillAt, lang),
    prorated: money(s.firstAmountCents),
    proFrom: day(s.paidThrough, lang),
    proTo: day(endOfThatMonth, lang),
    ...extra,
  });
}
