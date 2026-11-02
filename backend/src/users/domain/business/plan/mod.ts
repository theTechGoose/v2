// REQ-054 — the pure rules of a plan pick. The catalogue is the ONE pricing module the landing
// pages read (shared/quote-flow/pricing-plans.ts): what a plan costs here is what the site says.
import { PRICING_PLANS, type PricingPlan } from "#quote-flow/pricing-plans.ts";
import type { PayLinkError, PlanId, UserPlan } from "@users/dto/plan.ts";
import { anchoredSchedule, type BillingSchedule, switchedSchedule } from "#quote-flow/plan-switch.ts";
export { addMonth, type BillingSchedule, firstOfNextMonth, proratedCents, switchQuote, type SwitchQuote } from "#quote-flow/plan-switch.ts";
import { addMonth } from "#quote-flow/plan-switch.ts";

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
export function chosen(
  userId: string,
  planId: PlanId,
  now: string,
  link?: Pick<PayLinkInfo, "merchant"> & Partial<PayLinkInfo>,
  previousSubscriptionId?: string,
  /** REQ-127 — an UPGRADE from an active plan: the due is the difference, from that plan;
   *  REQ-129 — the new billing keeps the old one's anchor (its next bill) and what the plan is paid through */
  upgrade?: { dueCents: number; switchedFrom: PlanId; firstBillAt?: string; paidThrough?: string },
): UserPlan {
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
    ...(upgrade ? { dueCents: upgrade.dueCents, switchedFrom: upgrade.switchedFrom } : {}),
    ...(upgrade?.firstBillAt ? { firstBillAt: upgrade.firstBillAt } : {}),
    ...(upgrade?.paidThrough ? { paidThrough: upgrade.paidThrough } : {}),
  };
}

// ---- REQ-127 — an upgrade charges the difference, a downgrade refunds nothing ---------------
// Raphael, 2026-11-02: "alex paid $99 … when he upgrades its trying to charge him 399 not 300 for
// the difference." / "upgrade charges the difference, downgrade has no refund". The rule is the
// shared `switchQuote`; these are its records.

/** what the pending pick's due is for: the difference on an upgrade, the full first month otherwise */
export function dueCentsFor(plan: PricingPlan, pick: Pick<UserPlan, "dueCents">): number {
  return pick.dueCents ?? plan.priceCents;
}

/** the memo on the due — what the person reads on the pay page and the CRM on its row */
export function dueMemo(plan: PricingPlan, pick: Pick<UserPlan, "dueCents" | "switchedFrom">): string {
  if (pick.switchedFrom && pick.dueCents !== undefined) {
    const from = PRICING_PLANS.find((p) => p.id === pick.switchedFrom)?.name ?? pick.switchedFrom;
    return `${plan.name} — upgrade from ${from} (the difference)`;
  }
  return firstMonthMemo(plan);
}

/** a DOWNGRADE: the cheaper plan, active now, on the same customer and account; the old billing is
 *  canceled by the pick and the new one is ensured on the next read, first billing when the old one
 *  would have (`firstBillAt`) — the paid month kept, nothing refunded, no month charged twice */
export function downgraded(before: UserPlan, planId: PlanId, now: string, firstBillAt: string): UserPlan {
  return {
    userId: before.userId,
    planId,
    status: "active",
    chosenAt: now,
    activatedAt: now,
    updatedAt: now,
    ...(before.customerId ? { customerId: before.customerId } : {}),
    ...(before.merchant ? { merchant: before.merchant } : {}),
    switchedFrom: before.planId,
    firstBillAt,
    ...(before.paidThrough ? { paidThrough: before.paidThrough } : {}), // REQ-129 — the paid month is the same month
  };
}

// ---- REQ-129 — the billing anchors to the 1st ------------------------------------------------
// Raphael, 2026-11-02: "subscriptions should charge $399 whenever it happens, then on the 1st of
// the month prorated then every month $399." The rule is the shared `anchoredSchedule` /
// `switchedSchedule`; this reads the plan's record into it.

/** what the CRM is told when the plan's billing is started: a switch (`firstBillAt` on the record)
 *  keeps the old billing's anchor, prorated at the new price while the paid month reaches into
 *  that bill's month; a first pick bills on the 1st after activation for the days past paidThrough */
export function billingScheduleFor(plan: UserPlan, plan_: PricingPlan, now: string): BillingSchedule {
  const activatedAt = plan.activatedAt ?? plan.updatedAt;
  if (plan.firstBillAt) return switchedSchedule({ nextBillAt: plan.firstBillAt, paidThrough: plan.paidThrough }, plan_.priceCents, activatedAt || now);
  const { firstBillAt, firstAmountCents } = anchoredSchedule(activatedAt, plan_.priceCents);
  return { firstBillAt, firstAmountCents };
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
  /** REQ-129 — what the bill at nextBillAt is for; absent on a billing from before the CRM said */
  nextAmountCents?: number;
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
    const { subscriptionId: _s, nextBillAt: _n, nextBillCents: _c, cardBrand: _b, cardLast4: _l, ...rest } = plan;
    return { ...rest, status: "free", updatedAt: now };
  }
  const next: UserPlan = {
    ...plan,
    status: sub.status === "past_due" ? "past_due" : "active",
    subscriptionId: sub.subscriptionId,
    nextBillAt: sub.nextBillAt,
    ...(sub.nextAmountCents !== undefined ? { nextBillCents: sub.nextAmountCents } : {}), // REQ-129
    cardBrand: sub.cardBrand,
    cardLast4: sub.cardLast4,
    payUrl: sub.status === "past_due" ? sub.payUrl : "", // nothing to pay while current
  };
  return sameBilling(next, plan) ? plan : { ...next, updatedAt: now };
}

function sameBilling(a: UserPlan, b: UserPlan): boolean {
  return a.status === b.status && a.subscriptionId === b.subscriptionId && a.nextBillAt === b.nextBillAt && a.nextBillCents === b.nextBillCents &&
    a.cardBrand === b.cardBrand && a.cardLast4 === b.cardLast4 && a.payUrl === b.payUrl;
}

/** a pending plan goes active once its due is no longer open; anything else is left as it is.
 *  REQ-129 — the first month paid pays the plan through a calendar month later (`paidThrough`); an
 *  upgrade's difference pays the same month the plan was already paid through */
export function settle(plan: UserPlan, dueOpen: boolean, now: string): UserPlan {
  if (plan.status !== "pending" || dueOpen) return plan;
  return { ...plan, status: "active", activatedAt: now, updatedAt: now, paidThrough: plan.paidThrough ?? addMonth(now) };
}

// ---- REQ-131 — a paid due activates its plan, whenever the payer comes back --------------------
// Alex, 2026-11-02: the gateway approved his $99 at 15:53:22, the receipt had him on /plan/return
// at 15:53:28, the CRM's deferred settlement landed at 15:53:55 — the one refresh read "still
// open", nothing asked again, and three re-picks buried the paid pick under a $399 first-month due.
// Raphael: "figure out why the hell it never logged Alex's payment" / "fix it." A minted due is
// WATCHED by the outbox's sweep until it settles; this is what the watch does with what it reads.

export type WatchOutcome =
  /** the due is still open: ask again later */
  | { kind: "waiting" }
  /** settled, and nothing to write: the plan is no longer pending (already active, back to free, gone) */
  | { kind: "nothing"; why: string }
  /** settled: the pending pick that carries this due, active */
  | { kind: "settled"; plan: UserPlan }
  /** settled, but a later unpaid pick replaced the record: the pick the money paid for, active again */
  | { kind: "restored"; plan: UserPlan };

/** what a settle watch writes: `current` is the plan as stored now, `watched` the pick the due was minted for */
export function watchOutcome(current: UserPlan | null, watched: UserPlan, dueOpen: boolean, now: string): WatchOutcome {
  if (dueOpen) return { kind: "waiting" };
  if (!current) return { kind: "nothing", why: "no plan on record" };
  if (current.status !== "pending") return { kind: "nothing", why: `the plan is ${current.status} (${current.planId})` };
  if (current.dueId === watched.dueId) return { kind: "settled", plan: settle(current, false, now) };
  // a switch (REQ-127) comes from an ACTIVE plan: the paid pick went active already and this is the person's next move
  if (current.switchedFrom) return { kind: "nothing", why: `the plan is a switch from ${current.switchedFrom} to ${current.planId}` };
  // a later pick, not paid, sits where the paid one was: the paid one stands — no page to resume, it is paid
  const { payUrl: _page, payLinkError: _error, ...paid } = watched;
  return { kind: "restored", plan: settle({ ...paid, status: "pending" }, false, now) };
}
