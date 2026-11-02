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
  /** DOWNGRADE — when the cheaper billing starts: the old billing's next bill, or a month from now
   *  when the CRM never said; null when the billing starts a month after activation as usual */
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
      firstBillAt: null,
      fromPlanId: held.id,
    };
  }
  return {
    kind: "downgrade",
    dueCents: 0,
    monthlyCents: target.priceCents,
    firstBillAt: current.nextBillAt || addMonth(now),
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
