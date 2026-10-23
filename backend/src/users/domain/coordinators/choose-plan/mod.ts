// REQ-054 — picking a plan. Free is stored as free. A paid pick goes through the CRM's link
// builder: the account's CRM customer (REQ-058: the one made at sign-up, revised with what the
// account says now; the account's email — never invented), the first month as a due, the pay
// link that collects it; the plan is pending until the due settles on that pay page, then
// active. REQ-059: the link carries the way back — the app's /plan/return, which calls
// `refresh` on arrival, so the plan reads active without a "Check payment".
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
import { addMonth, chosen, isOneTime, monthlyMemo, type PickBack, planOf, RETURN_LABEL, returnUrlFor, settle, subscriptionRefFor, type SubscriptionView, withSubscription } from "@users/domain/business/plan/mod.ts";
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

  /** the plan as it stands — a paid one as the CRM's monthly billing says it stands (REQ-061) */
  async current(userId: string): Promise<UserPlan | null> {
    const plan = await this.plans.get(userId);
    return plan ? await this.projected(plan) : null;
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
    const before = await this.plans.get(userId);
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
    // REQ-106 — the reply: pending through that account; a switch of paid plan carries the billing
    // in force, canceled once the new one is live. The CRM's customer, due and pay page: the sweep's.
    const pending = await this.plans.put(chosen(userId, plan.id as PlanId, now, { merchant: account }, billing));
    await this.leads.enqueuePayLink(userId, back);
    return pending;
  }

  /** a pending plan asks the CRM whether its due settled (what /plan/return does on arrival,
   *  REQ-059); anything else is answered as stored */
  async refresh(userId: string): Promise<UserPlan> {
    const plan = await this.plans.get(userId);
    if (!plan) throw Object.assign(new Error("plan-missing: nothing picked yet"), { status: 404 });
    if (plan.status !== "pending" || !plan.dueId) return await this.projected(plan);
    const open = await this.link.dueOpen(plan.dueId);
    const next = settle(plan, open, new Date().toISOString());
    if (next === plan) return plan;
    const active = await this.projected(await this.plans.put(next));
    await this.leads.enqueueSync(userId); // REQ-062/099 — a paying customer: the CRM's tier is the plan's name, after this reply
    await this.leads.enqueueSignupNotice(userId, "paid"); // REQ-112 — the team hears the payment landed, with the plan on it
    return active;
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
    const { subscriptionId } = await this.link.startSubscription({
      customerId: plan.customerId,
      amountCents: pricing.priceCents,
      memo: monthlyMemo(pricing),
      externalRef: ref,
      firstBillAt: addMonth(plan.activatedAt ?? plan.updatedAt),
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
