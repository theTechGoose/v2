/**
 * REQ-127 — the ONE rule of a plan switch. Raphael, 2026-11-02: "i see alex paid $99, it seems
 * that he picked the wrong plan, but when he upgrades its trying to charge him 399 not 300 for
 * the difference." / "upgrade charges the difference, downgrade has no refund".
 *
 * Read by the backend (what the due is, when the new billing starts) and drawn by the Billing
 * tab (what a card says it will do), so the page can never promise one number and the CRM
 * charge another. Pure: the catalogue is the one pricing module, the input is the plan as the
 * account holds it.
 *
 *  - UPGRADE   — from an ACTIVE monthly plan to a dearer one: the due is the difference of the two
 *                list prices; the new billing runs at the new price a month after activation.
 *  - DOWNGRADE — from an active monthly plan to a cheaper one: nothing charged, nothing refunded;
 *                the plan switches now and the cheaper billing starts the day the old one would
 *                have billed next (`firstBillAt`), so the paid month is kept and no month is
 *                charged twice.
 *  - FIRST     — everything else is a first pick at full price: from free, from a pending pick
 *                nobody paid, from past due, to or from the one-time test tier.
 *  - FREE      — back to free: REQ-056/061, the billing stops, no refund.
 *  - SAME      — the plan already active: nothing to charge, nothing to start.
 */
import { PRICING_PLANS, type PricingPlan } from "./pricing-plans.ts";

export type SwitchKind = "free" | "first" | "upgrade" | "downgrade" | "same";

/** the plan as the account holds it (the backend's UserPlan, the page's snapshot): what matters here */
export interface SwitchCurrent {
  planId: string;
  status: "free" | "pending" | "active" | "past_due";
  /** REQ-061 — when the current billing falls due next, when the CRM has said */
  nextBillAt?: string;
}

export interface SwitchQuote {
  kind: SwitchKind;
  /** what is charged today: the difference on an upgrade, the full first month on a first pick, 0 otherwise */
  dueCents: number;
  /** what the plan costs a month once it is live (0 for free) */
  monthlyCents: number;
  /** a SWITCH (upgrade or downgrade) — when the new billing first bills: the old billing's next
   *  bill (REQ-129: the next 1st), so the paid month is kept and no month is charged twice; on a
   *  downgrade, the next 1st from now when the CRM never said; null on a first pick (the anchored
   *  schedule, `anchoredSchedule`) and on an upgrade whose old billing the CRM never described */
  firstBillAt: string | null;
  /** the plan the switch comes from, on an upgrade, a downgrade, the same plan or back to free */
  fromPlanId: string | null;
}

/** @throws plan-unknown — an id the catalogue does not carry */
export function planById(id: string): PricingPlan {
  const plan = PRICING_PLANS.find((p) => p.id === id);
  if (!plan) {
    throw Object.assign(new Error(`plan-unknown: ${id}`), { status: 400 });
  }
  return plan;
}

function paidMonthly(plan: PricingPlan): boolean {
  return plan.period === "monthly" && plan.priceCents > 0 && !plan.custom;
}

export function switchQuote(
  current: SwitchCurrent | null | undefined,
  targetId: string,
  now: string,
): SwitchQuote {
  const target = planById(targetId);
  const from = current?.planId ?? null;
  if (target.id === "free") {
    return {
      kind: "free",
      dueCents: 0,
      monthlyCents: 0,
      firstBillAt: null,
      fromPlanId: from,
    };
  }
  const first: SwitchQuote = {
    kind: "first",
    dueCents: target.priceCents,
    monthlyCents: target.priceCents,
    firstBillAt: null,
    fromPlanId: null,
  };
  if (!current || current.status !== "active") return first;
  const held = PRICING_PLANS.find((p) => p.id === current.planId);
  if (!held || !paidMonthly(held) || !paidMonthly(target)) return first;
  if (held.id === target.id) {
    return {
      kind: "same",
      dueCents: 0,
      monthlyCents: target.priceCents,
      firstBillAt: null,
      fromPlanId: held.id,
    };
  }
  const diff = target.priceCents - held.priceCents;
  if (diff > 0) {
    return {
      kind: "upgrade",
      dueCents: diff,
      monthlyCents: target.priceCents,
      firstBillAt: current.nextBillAt || null,
      fromPlanId: held.id,
    };
  }
  return {
    kind: "downgrade",
    dueCents: 0,
    monthlyCents: target.priceCents,
    firstBillAt: current.nextBillAt || firstOfNextMonth(now),
    fromPlanId: held.id,
  };
}

/** a calendar month later, same day and time; a day the next month lacks lands on its last (the CRM's rule too) */
export function addMonth(iso: string): string {
  const d = new Date(iso);
  const lastOfNext = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0),
  ).getUTCDate();
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    Math.min(d.getUTCDate(), lastOfNext),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  )).toISOString();
}

// ---- REQ-129 — the calendar-anchored schedule -------------------------------------------------
// Raphael, 2026-11-02: "subscriptions should charge $399 whenever it happens, then on the 1st of
// the month prorated then every month $399." The pay page collects the full month on the day of
// the pick — that pays the plan through a calendar month later (`paidThrough`). The billing then
// anchors to the 1st: the first bill falls on the 1st of the following month, for the days of that
// month past paidThrough at the month's rate; every 1st after it is the full price. Picked on the
// 1st, paidThrough IS the next 1st, so the "prorated" first bill is the whole month. One rule, read
// by the backend (what the CRM is told) and drawn by the Billing tab (what the next bill says).

export interface BillingSchedule {
  /** when the new billing first bills (ISO) */
  firstBillAt: string;
  /** what that first bill is for: the prorated days, or the full month */
  firstAmountCents: number;
}

/** the 1st of the month after `iso`, 00:00 UTC */
export function firstOfNextMonth(iso: string): string {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toISOString();
}

/** the month's rate for the days from `paidThrough` to the end of its month, inclusive, to the
 *  cent; paid through the 1st = the whole month */
export function proratedCents(
  monthlyCents: number,
  paidThrough: string,
): number {
  const d = new Date(paidThrough);
  const day = d.getUTCDate();
  if (day === 1) return monthlyCents;
  const daysInMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return Math.round(monthlyCents * (daysInMonth - day + 1) / daysInMonth);
}

/** a FIRST pick, paid at `activatedAt`: paid through a month later; the first bill on the next
 *  1st for the days past that; the full price every 1st after */
export function anchoredSchedule(
  activatedAt: string,
  monthlyCents: number,
): BillingSchedule & { paidThrough: string } {
  const paidThrough = addMonth(activatedAt);
  return {
    paidThrough,
    firstBillAt: firstOfNextMonth(activatedAt),
    firstAmountCents: proratedCents(monthlyCents, paidThrough),
  };
}

/** a SWITCH at `now`, from a billing the CRM described (`nextBillAt`) on a plan paid through
 *  `paidThrough`: the new billing keeps the anchor — its first bill is the old one's next (the next
 *  1st from now when the CRM never said, or when that next is already behind us), prorated at the
 *  new price while the paid month still reaches into that bill's month (the old billing had not
 *  collected its first bill), the full new price otherwise — a plan from before the anchor (no
 *  paidThrough) is the full price, REQ-127 as it was */
export function switchedSchedule(
  current: { nextBillAt?: string; paidThrough?: string },
  monthlyCents: number,
  now: string,
): BillingSchedule {
  const next = current.nextBillAt && current.nextBillAt > now
    ? current.nextBillAt
    : firstOfNextMonth(now);
  const prorated = Boolean(current.paidThrough) && current.paidThrough! >= next;
  return {
    firstBillAt: next,
    firstAmountCents: prorated
      ? proratedCents(monthlyCents, current.paidThrough!)
      : monthlyCents,
  };
}
