// REQ-054 — the pure rules of a plan pick. The catalogue is the ONE pricing module the landing
// pages read (shared/quote-flow/pricing-plans.ts): what a plan costs here is what the site says.
import { PRICING_PLANS, type PricingPlan } from "#quote-flow/pricing-plans.ts";
import type { PayLinkError, PlanId, UserPlan } from "@users/dto/plan.ts";

/** the plans a person can pick: the public monthly ones; assist-plus — REQ-118/119: the hidden
 *  $399 tier, a card in the settings upgrade panel alone; Projects is custom — "call us"; test —
 *  REQ-064: the hidden $1 one-time tier, picked only from /plan/test */
export const SELECTABLE_PLAN_IDS: readonly PlanId[] = ["free", "monster", "assist", "assist-plus", "test"];

export function isSelectable(id: string): id is PlanId {
  return (SELECTABLE_PLAN_IDS as readonly string[]).includes(id);
}

/** @throws plan-unknown — not a selectable plan */
export function planOf(id: string): PricingPlan {
  const plan = isSelectable(id) ? PRICING_PLANS.find((p) => p.id === id) : undefined;
  if (!plan) throw Object.assign(new Error(`plan-unknown: ${id}`), { status: 400 });
  return plan;
}

/** REQ-064 — a plan charged once, never monthly (the test tier) */
export function isOneTime(plan: PricingPlan): boolean {
  return plan.period === "one-time";
}

/** REQ-064 — the merchant account a pick names: a slug (lowercase letters, digits, dashes, up to
 *  40), trimmed and lowercased; nothing = "" (the CRM's default); anything else is refused by name
 *  @throws merchant-invalid (400) */
export function merchantOf(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "";
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "\u0000";
  if (!/^[a-z0-9-]{1,40}$/.test(v)) {
    throw Object.assign(new Error("merchant-invalid: a merchant is lowercase letters, digits and dashes"), { status: 400 });
  }
  return v;
}

/** the memo on the first month's due — what the person reads on the pay page; a one-time
 *  charge (REQ-064) is not a first month */
export function firstMonthMemo(plan: PricingPlan): string {
  return isOneTime(plan) ? `${plan.name} — one-time test charge` : `${plan.name} — first month`;
}

/** REQ-062 — what the CRM calls a person who has not said who they are: a phone typed into login,
 *  a sign-up that stopped before the name. Raphael's words; the phone on the record is the key. */
export const UNNAMED_CUSTOMER = "unknown dragon mcdragonson";

/** the CRM customer is the business, else the person, else the unnamed one (REQ-058: at sign-up
 *  that is all the account has — the name arrives with onboarding; REQ-062) */
export function customerNameFor(
  user: { name?: string; email?: string; phoneNumber?: string },
  identity: { businessName?: string } | null,
): string {
  return identity?.businessName?.trim() || user.name?.trim() || UNNAMED_CUSTOMER;
}

/** REQ-062 — the CRM's tier for an account that has never paid (the CRM's dial-list tier) */
export const LEAD_TIER = "Lead";

/** REQ-062 — the tier the CRM customer wears: a paid plan that is current (or a month being
 *  retried) is the plan's name; nothing picked, or a pick not paid yet, is Lead. REQ-111 — the free
 *  plan is the CRM ladder's own Free rung ("on the free plan — the first upsell call"), so the
 *  selected plan reads on the record. */
export const FREE_TIER = "Free";
export function tierFor(plan: UserPlan | null): string {
  if (!plan) return LEAD_TIER;
  if (plan.planId === "free") return FREE_TIER;
  if (plan.status !== "active" && plan.status !== "past_due") return LEAD_TIER;
  const pricing = planOf(plan.planId);
  if (isOneTime(pricing)) return LEAD_TIER; // REQ-064 — a test charge is not a membership
  return pricing.name;
}

/** REQ-058 — the ref this app's account carries on its CRM customer: ONE customer per account,
 *  made at sign-up and revised by every later write (the CRM upserts by it, ppwk-crm REQ-076) */
export function externalRefFor(userId: string): string {
  return `pm:${userId}`;
}

/** REQ-059 — what the pay page's receipt calls this app on its way back */
export const RETURN_LABEL = "DocuMonster";

/** the pages that show the plan cards — the only places a pick comes back to */
const PICK_BACKS = ["/welcome", "/settings"] as const;
export type PickBack = typeof PICK_BACKS[number];
export function pickBackOf(raw: unknown): PickBack {
  return (PICK_BACKS as readonly unknown[]).includes(raw) ? raw as PickBack : "/settings";
}

/** REQ-059 — where the receipt brings the person back: the app's return page, naming the due it
 *  settled and the page the pick came from, so the plan is read active on arrival and the person
 *  continues where they were — no "Check payment" */
export function returnUrlFor(appOrigin: string, dueId: string, back: PickBack): string {
  return `${appOrigin.replace(/\/+$/, "")}/plan/return?${new URLSearchParams({ due: dueId, back })}`;
}

export interface PayLinkInfo {
  customerId: string;
  dueId: string;
  payUrl: string;
  /** REQ-064/100 — the merchant account the charge goes through: the one source of truth the
   *  pay link, the pay page's footer and the billing all read; required on a paid pick */
  merchant: string;
}

/**
 * the record of a pick: free is free; a paid pick is pending on its due — from the reply on
 * (REQ-106): the account the charge goes through is decided here (REQ-100); the CRM's customer,
 * due and pay page come by the sweep (`minted`) and are absent meanwhile (`isPreparing`)
 * @throws pay-link-missing — a paid pick without the merchant account the charge goes through
 */
export function chosen(userId: string, planId: PlanId, now: string, link?: Pick<PayLinkInfo, "merchant"> & Partial<PayLinkInfo>, previousSubscriptionId?: string): UserPlan {
  if (planId === "free") return { userId, planId, status: "free", chosenAt: now, updatedAt: now };
  if (!link?.merchant) throw new Error("pay-link-missing: a paid plan names the merchant account the charge goes through");
  const { customerId, dueId, payUrl, merchant } = link;
  return {
    userId,
    planId,
    status: "pending",
    chosenAt: now,
    updatedAt: now,
    merchant,
    ...(customerId ? { customerId } : {}),
    ...(dueId ? { dueId } : {}),
    ...(payUrl ? { payUrl } : {}),
    ...(previousSubscriptionId ? { previousSubscriptionId } : {}),
  };
}

// ---- REQ-106 — the pay page comes after the reply --------------------------------------------
// Raphael, 2026-10-20: "when i click a plan in the onboarding flow the payment link takes FOREVER
// to load … i dont care if it happens asyncronously … what i care about is that the user
// experience is good."

/** a pending pick whose pay page the sweep has not minted yet */
export function isPreparing(plan: UserPlan): boolean {
  return plan.status === "pending" && !plan.payUrl;
}

/** the sweep's result on the record: the same customer, due and page the reply used to carry;
 *  a refusal read on it meanwhile is cleared */
export function minted(plan: UserPlan, link: PayLinkInfo, now: string): UserPlan {
  const { payLinkError: _cleared, ...rest } = plan;
  return { ...rest, customerId: link.customerId, dueId: link.dueId, payUrl: link.payUrl, merchant: link.merchant, updatedAt: now };
}

/** the CRM's answer read on the pick: a name it has no account for (final), or no answer yet (retried) */
export function payLinkFailed(plan: UserPlan, error: PayLinkError, now: string): UserPlan {
  return { ...plan, payLinkError: error, updatedAt: now };
}

/** is this the pick the sweep set out to mint: the same plan, chosen at the same moment, through
 *  the same account — a newer pick is never written over with the stale page */
export function samePick(a: UserPlan, b: UserPlan): boolean {
  return a.planId === b.planId && a.chosenAt === b.chosenAt && a.merchant === b.merchant;
}

// ---- REQ-061 — monthly billing: the CRM's subscription behind an active plan ----------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** a calendar month later, same day and time; a day the next month lacks lands on its last (the CRM's rule too) */
export function addMonth(iso: string): string {
  const d = new Date(iso);
  const lastOfNext = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)).getUTCDate();
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

/** "November 2026" — the month a due is for */
export function monthLabel(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** this app's handle for one plan's billing on the CRM: the account's ref and the plan */
export function subscriptionRefFor(userId: string, planId: PlanId): string {
  return `${externalRefFor(userId)}:${planId}`;
}

/** what the monthly due says (the CRM appends the month) */
export function monthlyMemo(plan: PricingPlan): string {
  return plan.name;
}

export interface SubscriptionView {
  subscriptionId: string;
  status: "active" | "past_due" | "canceled";
  nextBillAt: string;
  cardBrand: string;
  cardLast4: string;
  payUrl: string;
}

/**
 * what the CRM's billing says about the plan: current carries the next bill and the card; a
 * month it could not collect makes the plan PAST DUE, with that month's pay page; a billing
 * canceled on the CRM's side drops the plan to free. Nothing to say leaves the plan as it is.
 */
export function withSubscription(plan: UserPlan, sub: SubscriptionView | null, now: string): UserPlan {
  if (!sub) return plan;
  if (sub.status === "canceled") {
    if (plan.status === "free") return plan;
    const { subscriptionId: _s, nextBillAt: _n, cardBrand: _b, cardLast4: _l, ...rest } = plan;
    return { ...rest, status: "free", updatedAt: now };
  }
  const next: UserPlan = {
    ...plan,
    status: sub.status === "past_due" ? "past_due" : "active",
    subscriptionId: sub.subscriptionId,
    nextBillAt: sub.nextBillAt,
    cardBrand: sub.cardBrand,
    cardLast4: sub.cardLast4,
    payUrl: sub.status === "past_due" ? sub.payUrl : "", // nothing to pay while current
  };
  return sameBilling(next, plan) ? plan : { ...next, updatedAt: now };
}

function sameBilling(a: UserPlan, b: UserPlan): boolean {
  return a.status === b.status && a.subscriptionId === b.subscriptionId && a.nextBillAt === b.nextBillAt &&
    a.cardBrand === b.cardBrand && a.cardLast4 === b.cardLast4 && a.payUrl === b.payUrl;
}

/** a pending plan goes active once its due is no longer open; anything else is left as it is */
export function settle(plan: UserPlan, dueOpen: boolean, now: string): UserPlan {
  if (plan.status !== "pending" || dueOpen) return plan;
  return { ...plan, status: "active", activatedAt: now, updatedAt: now };
}
