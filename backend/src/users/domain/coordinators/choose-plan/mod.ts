// REQ-054 — picking a plan. Free is stored as free. A paid pick goes through the CRM's link
// builder: the customer (the business, else the person; the account's email — never invented),
// the first month as a due, the pay link that collects it; the plan is pending until the due
// settles on that pay page, then active. `refresh` is what "Check payment" presses.
import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { chosen, customerNameFor, firstMonthMemo, planOf, settle } from "@users/domain/business/plan/mod.ts";
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
    private identity: BusinessIdentityStore,
    private plans: PlanStore,
    private link: PaymentsLink,
  ) {}

  current(userId: string): Promise<UserPlan | null> {
    return this.plans.get(userId);
  }

  /**
   * @throws plan-unknown — not a selectable plan
   * @throws email-required — a paid pick with no email on the account
   * @throws payments-unavailable — the CRM did not answer
   */
  async choose(userId: string, planId: string): Promise<UserPlan> {
    const plan = planOf(planId);
    const now = new Date().toISOString();
    if (plan.id === "free") return this.plans.put(chosen(userId, "free", now));

    const [user, identity] = await Promise.all([this.users.get(userId), this.identity.get(userId)]);
    const email = user.email?.trim() ?? "";
    if (!email) throw new EmailRequiredError();

    const { customerId } = await this.link.createCustomer({ customerName: customerNameFor(user, identity), customerEmail: email });
    const { dueId } = await this.link.raiseDue({ customerId, amountCents: plan.priceCents, memo: firstMonthMemo(plan) });
    const { payUrl } = await this.link.mintPayLink({ customerId, dueId });
    return this.plans.put(chosen(userId, plan.id as "monster" | "assist", now, { customerId, dueId, payUrl }));
  }

  /** a pending plan asks the CRM whether its due settled; anything else is answered as stored */
  async refresh(userId: string): Promise<UserPlan> {
    const plan = await this.plans.get(userId);
    if (!plan) throw Object.assign(new Error("plan-missing: nothing picked yet"), { status: 404 });
    if (plan.status !== "pending" || !plan.dueId) return plan;
    const open = await this.link.dueOpen(plan.dueId);
    const next = settle(plan, open, new Date().toISOString());
    return next === plan ? plan : this.plans.put(next);
  }
}
