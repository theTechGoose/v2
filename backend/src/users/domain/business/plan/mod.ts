// REQ-054 — the pure rules of a plan pick. The catalogue is the ONE pricing module the landing
// pages read (shared/quote-flow/pricing-plans.ts): what a plan costs here is what the site says.
import { PRICING_PLANS, type PricingPlan } from "#quote-flow/pricing-plans.ts";
import type { PlanId, UserPlan } from "@users/dto/plan.ts";

/** the plans a person can pick: the public monthly ones; Projects is custom — "call us" */
export const SELECTABLE_PLAN_IDS: readonly PlanId[] = ["free", "monster", "assist"];

export function isSelectable(id: string): id is PlanId {
  return (SELECTABLE_PLAN_IDS as readonly string[]).includes(id);
}

/** @throws plan-unknown — not a selectable plan */
export function planOf(id: string): PricingPlan {
  const plan = isSelectable(id) ? PRICING_PLANS.find((p) => p.id === id) : undefined;
  if (!plan) throw Object.assign(new Error(`plan-unknown: ${id}`), { status: 400 });
  return plan;
}

/** the memo on the first month's due — what the person reads on the pay page */
export function firstMonthMemo(plan: PricingPlan): string {
  return `${plan.name} — first month`;
}

/** the CRM customer is the business, else the person, else the email */
export function customerNameFor(
  user: { name?: string; email?: string },
  identity: { businessName?: string } | null,
): string {
  return identity?.businessName?.trim() || user.name?.trim() || user.email?.trim() || "";
}

export interface PayLinkInfo {
  customerId: string;
  dueId: string;
  payUrl: string;
}

/**
 * the record of a pick: free is free; a paid pick is pending on its due
 * @throws pay-link-missing — a paid pick without the CRM's customer, due and pay page
 */
export function chosen(userId: string, planId: PlanId, now: string, link?: PayLinkInfo): UserPlan {
  if (planId === "free") return { userId, planId, status: "free", chosenAt: now, updatedAt: now };
  if (!link?.customerId || !link.dueId || !link.payUrl) {
    throw new Error("pay-link-missing: a paid plan needs the CRM's customer, due and pay page");
  }
  return { userId, planId, status: "pending", chosenAt: now, updatedAt: now, ...link };
}

/** a pending plan goes active once its due is no longer open; anything else is left as it is */
export function settle(plan: UserPlan, dueOpen: boolean, now: string): UserPlan {
  if (plan.status !== "pending" || dueOpen) return plan;
  return { ...plan, status: "active", activatedAt: now, updatedAt: now };
}
