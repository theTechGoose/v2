// REQ-054 — the plan a person picked: free, or a paid plan that is pending until the first
// month's due settles on the CRM's pay page, then active.
import { merchantOf, type PickBack, pickBackOf } from "@users/domain/business/plan/mod.ts";
/** assist-plus — REQ-118: Monster Assist+, the $399 tier, picked from settings alone (REQ-119: hidden
 *  from the site and from onboarding); test — REQ-064: the hidden $1 one-time test tier */
export type PlanId = "free" | "monster" | "assist" | "assist-plus" | "test";
/** past_due — REQ-061: the CRM could not collect the latest month; the person pays it on the pay page */
export type PlanStatus = "free" | "pending" | "active" | "past_due";
/** REQ-106 — why a pending pick has no pay page yet: the CRM has no account by the name the pick
 *  gave (final — the person picks again), or the CRM did not answer (the sweep retries) */
export type PayLinkError = "merchant-unknown" | "payments-unavailable";

export interface UserPlan {
  userId: string;
  planId: PlanId;
  status: PlanStatus;
  /** when this pick was made (server ISO) */
  chosenAt: string;
  /** when the due settled and the plan went active */
  activatedAt?: string;
  /** the CRM's customer and due behind a paid pick, and the pay page the person opens */
  customerId?: string;
  dueId?: string;
  /** the pay page: the first month's while pending; the past-due month's while past due */
  payUrl?: string;
  /** REQ-061 — the CRM's monthly billing behind an active plan, and what it says */
  subscriptionId?: string;
  nextBillAt?: string;
  cardBrand?: string;
  cardLast4?: string;
  /** the billing a paid pick replaces (a switch of plan): canceled once the new one is live */
  previousSubscriptionId?: string;
  /** REQ-064/100 — the merchant account the charge goes through (the CRM's `x-account`): on every
   *  paid pick, the one name the pay link, the pay page's footer and the billing share; free has none */
  merchant?: string;
  /** REQ-106 — read on a pending pick whose page the sweep could not mint; cleared the moment the
   *  page lands. Absent and no payUrl = the page is being prepared. */
  payLinkError?: PayLinkError;
  updatedAt: string;
}

/** `POST /me/plan` body — `back`: the page the pick came from (REQ-059: where the receipt brings
 *  the person back to); anything but a cards page reads as settings */
export interface ChoosePlanDto {
  planId: string;
  back: PickBack;
  /** REQ-064/100 — the merchant account the pick names, a slug; "" = decided by the one rule
   *  (shared/quote-flow/merchant-accounts.ts: sandbox for the test tier, primary for a real plan) */
  merchant: string;
}

export function parseChoosePlan(input: unknown): ChoosePlanDto {
  const body = input as { planId?: unknown; back?: unknown; merchant?: unknown } | null;
  const planId = body?.planId;
  if (typeof planId !== "string" || !planId.trim()) {
    throw Object.assign(new Error("plan-id-required: body.planId is a plan id"), { status: 400 });
  }
  return { planId: planId.trim(), back: pickBackOf(body?.back), merchant: merchantOf(body?.merchant) };
}
