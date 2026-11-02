// REQ-054 — picking a plan. Free is stored as free. A paid pick goes through the CRM's link
// builder: the account's CRM customer (REQ-058: the one made at sign-up, revised with what the
// account says now; the account's email — never invented), the first month as a due, the pay
// link that collects it; the plan is pending until the due settles on that pay page, then
// active. REQ-059: the link carries the way back — the app's /plan/return, a redirect; the plan
// reads active without a "Check payment" because every read asks the CRM of a pending due (REQ-133).
// REQ-127 — Raphael, 2026-11-02: "upgrade charges the difference, downgrade has no refund": the
// switch rule is the shared `switchQuote`; an upgrade's pending record carries the difference its
// due is for, a downgrade is active at once with the old billing canceled and the cheaper one
// starting when the old one would have billed.
// REQ-106 — Raphael, 2026-10-20: "when i click a plan in the onboarding flow the payment link
// takes FOREVER to load, can we speed it up and keep the exact same result in the crm? i dont care
// if it happens asyncronously … what i care about is that the user experience is good." The paid
// pick replies at once — pending, through the account the one rule decides — and the three CRM
// calls ride the lead outbox (CrmLeadCapture.enqueuePayLink → PayLinkMint, after the reply), the
// same calls in the same order; the browser waits on /plan/pay until the page is on the record.
import { Injectable } from "#danet/core";
import { accountForPick } from "#quote-flow/merchant-accounts.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { appOrigin, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { billingScheduleFor, chosen, downgraded, isOneTime, monthlyMemo, type PickBack, planOf, RETURN_LABEL, returnUrlFor, settle, subscriptionRefFor, type SubscriptionView, switchQuote, withSubscription } from "@users/domain/business/plan/mod.ts";
import type { PlanId } from "@users/dto/plan.ts";
import type { UserPlan } from "@users/dto/plan.ts";

class EmailRequiredError extends Error {
  readonly status = 409;
  constructor() {
    super("email-required: a paid plan needs an email on the account");
    this.name = "EmailRequiredError";
  }
}

@Injectable()
export class ChoosePlan {
  constructor(
    private users: UserStore,
    private plans: PlanStore,
    private link: PaymentsLink,
    private crm: CrmCustomerSync,
    /** REQ-099 — the CRM hears a tier change by the sweep, after the reply; REQ-106 — the paid pick's customer, due and pay link too */
    private leads: CrmLeadCapture,
  ) {}

  /** the plan as it stands — a pending one as the CRM says of its due (REQ-133), a paid one as the
   *  CRM's monthly billing says it stands (REQ-061) */
  async current(userId: string): Promise<UserPlan | null> {
    const plan = await this.plans.get(userId);
    return plan ? await this.projected(await this.settledOnRead(plan)) : null;
  }

  /** the plan as stored, projected against nothing (the fake's quiet settle reads this, REQ-131) */
  stored(userId: string): Promise<UserPlan | null> {
    return this.plans.get(userId);
  }

  /**
   * REQ-133 — Raphael, 2026-11-02: "The front end should not be doing any business logic, only
   * presentation logic. Put all of that in the back." There is no refresh for a page to press: a
   * pending plan with a due is read against the CRM by every read, the way an active one is read
   * against its billing (`projected`) — settled, it is active on that read, the watch is dropped,
   * the tier (REQ-062/099) and the paid notice (REQ-112) ride the outbox; open, it stays as stored
   * and the watch (REQ-131) keeps looking. A CRM that does not answer leaves it as stored.
   */
  private async settledOnRead(plan: UserPlan): Promise<UserPlan> {
    if (plan.status !== "pending" || !plan.dueId) return plan;
    try {
      const open = await this.link.dueOpen(plan.dueId);
      const next = settle(plan, open, new Date().toISOString());
      if (next === plan) return plan;
      const active = await this.plans.put(next);
      await this.leads.dropSettleWatch(plan.userId); // REQ-131 — the watch on this due is moot
      await this.leads.enqueueSync(plan.userId);
      await this.leads.enqueueSignupNotice(plan.userId, "paid");
      return active;
    } catch (e) {
      console.warn(`[choose-plan] ${plan.userId}: the due was not read: ${e instanceof Error ? e.message : String(e)}`);
      return plan;
    }
  }

  /**
   * @throws plan-unknown — not a selectable plan
   * @throws email-required — a paid pick with no email on the account
   * @throws payments-unavailable — the CRM did not answer a downgrade's cancel
   */
  /** REQ-064/100 — `merchant`: the merchant account the pick named, if it named one; the account the
   *  charge goes through is decided ONCE here, by the one rule (accountForPick: the name given,
   *  else sandbox for the $1 test tier, primary for every real plan), and that one name rides the
   *  pay link, the pay page's footer and the plan's record, which the billing reads later.
   *  REQ-106 — a paid pick replies pending with that account and no page: the CRM's customer, due
   *  and pay link are minted by the sweep after the reply (PayLinkMint) and land on the record;
   *  a name the CRM has no account for (REQ-101) is read on the record as merchant-unknown. */
  async choose(userId: string, planId: string, back: PickBack = "/settings", merchant = ""): Promise<UserPlan> {
    const plan = planOf(planId);
    const now = new Date().toISOString();
    let before = await this.plans.get(userId);
    // REQ-132 — a pick while a pick is pending asks the CRM first: a due paid a moment ago makes this
    // a switch from the plan it paid for, never a second first pick written over it (Alex's three
    // re-picks buried his paid $99 under a $399 due). Best effort (settledOnRead): a CRM that does
    // not answer leaves the record as stored, and the due's watch (REQ-131) restores the paid pick.
    if (before?.status === "pending" && before.dueId) before = await this.current(userId);
    // the billing a paid pick replaces: an active plan's — or the one a pending pick, not paid yet, already replaced
    const billing = before && before.status !== "free" ? (before.subscriptionId ?? before.previousSubscriptionId) : undefined;
    if (plan.id === "free") {
      // REQ-061 — back to free stops the billing; the CRM has to take that, or the plan stays
      if (billing) await this.link.cancelSubscription(billing, "downgraded to free");
      const free = await this.plans.put(chosen(userId, "free", now));
      await this.leads.enqueueSync(userId); // REQ-062/099 — the CRM's tier is Lead again, after this reply
      return free;
    }

    const user = await this.users.get(userId);
    if (!user.email?.trim()) throw new EmailRequiredError();

    const account = accountForPick(plan.id, merchant); // REQ-100 — decided once, here
    // REQ-132 — the same plan picked again while its page is pending: that page (minted, or being
    // minted by the sweep) is the answer, not a second due and a second link
    if (before?.status === "pending" && before.planId === plan.id && before.merchant === account && before.payLinkError !== "merchant-unknown") return before;

    // REQ-127 — the one switch rule: an upgrade charges the difference, a downgrade nothing
    const quote = switchQuote(before, plan.id, now);
    if (quote.kind === "same") return before!;
    if (quote.kind === "downgrade") {
      // nothing to pay, nothing refunded: the plan switches now; the old billing stops (the CRM has
      // to take that, or the plan stays, as on the way to free) and the cheaper one is ensured on
      // this read, first billing the day the old one would have
      if (billing) await this.link.cancelSubscription(billing, `downgraded to ${plan.id}`);
      const stored = await this.plans.put(downgraded(before!, plan.id as PlanId, now, quote.firstBillAt!));
      const live = await this.projected(stored);
      await this.leads.enqueueSync(userId); // REQ-062/099 — the CRM's tier is the cheaper plan's name, after this reply
      return live;
    }
    // REQ-129 — the new billing keeps the old one's anchor (its next bill, the 1st) and the month already paid through
    const upgrade = quote.kind === "upgrade" ? { dueCents: quote.dueCents, switchedFrom: before!.planId, firstBillAt: quote.firstBillAt ?? undefined, paidThrough: before!.paidThrough } : undefined;

    // REQ-106 — the reply: pending through that account; a switch of paid plan carries the billing
    // in force, canceled once the new one is live. The CRM's customer, due and pay page: the sweep's.
    const pending = await this.plans.put(chosen(userId, plan.id as PlanId, now, { merchant: account }, billing, upgrade));
    await this.leads.enqueuePayLink(userId, back);
    return pending;
  }

  /**
   * REQ-061 — an active paid plan is billed monthly by the CRM. The billing is started the first
   * time the plan is read active (found again by its handle if that write was lost — never
   * started twice), and what it says — the next bill, the card, a month it could not collect —
   * IS the plan's state. A CRM that does not answer leaves the plan as last stored.
   */
  private async projected(plan: UserPlan): Promise<UserPlan> {
    if (plan.planId === "free" || (plan.status !== "active" && plan.status !== "past_due")) return plan;
    if (isOneTime(planOf(plan.planId))) return plan; // REQ-064 — a one-time charge starts no billing
    try {
      const sub = plan.subscriptionId ? await this.link.subscription(plan.subscriptionId) : await this.ensureSubscription(plan);
      const next = withSubscription(plan, sub, new Date().toISOString());
      if (next === plan) return plan;
      const stored = await this.plans.put(next);
      if (next.status !== plan.status) await this.leads.enqueueSync(plan.userId); // REQ-062/099 — a billing canceled on the CRM drops the tier, after this reply
      return stored;
    } catch (e) {
      console.warn(`[choose-plan] ${plan.userId}: the billing was not read: ${e instanceof Error ? e.message : String(e)}`);
      return plan;
    }
  }

  private async ensureSubscription(plan: UserPlan): Promise<SubscriptionView | null> {
    const ref = subscriptionRefFor(plan.userId, plan.planId);
    const existing = await this.link.findSubscription(ref);
    if (existing && existing.status !== "canceled") return existing;
    if (!plan.customerId) return null;
    const pricing = planOf(plan.planId);
    // REQ-129 — anchored to the 1st: a first pick bills on the 1st after activation for the days past the
    // month it paid; a switch (REQ-127) bills first when the old billing would have, prorated at the new price
    const schedule = billingScheduleFor(plan, pricing, new Date().toISOString());
    const { subscriptionId } = await this.link.startSubscription({
      customerId: plan.customerId,
      amountCents: pricing.priceCents,
      memo: monthlyMemo(pricing),
      externalRef: ref,
      firstBillAt: schedule.firstBillAt,
      firstAmountCents: schedule.firstAmountCents,
      returnUrl: returnUrlFor(appOrigin(), "", "/settings"),
      returnLabel: RETURN_LABEL,
      // REQ-064/100 — the same account the pick went through; a plan stored before the account
      // was recorded on it (REQ-069's env default) resolves by the one rule: primary
      merchant: accountForPick(plan.planId, plan.merchant ?? ""),
    });
    if (plan.previousSubscriptionId && plan.previousSubscriptionId !== subscriptionId) {
      try {
        await this.link.cancelSubscription(plan.previousSubscriptionId, `switched to ${plan.planId}`);
      } catch (e) {
        console.warn(`[choose-plan] ${plan.userId}: the previous billing was not canceled: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return await this.link.subscription(subscriptionId);
  }
}
