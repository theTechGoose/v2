// REQ-054 — picking a plan. Free is stored as free. A paid pick goes through the CRM's link
// builder: the account's CRM customer (REQ-058: the one made at sign-up, revised with what the
// account says now; the account's email — never invented), the first month as a due, the pay
// link that collects it; the plan is pending until the due settles on that pay page, then
// active. REQ-059: the link carries the way back — the app's /plan/return, which calls
// `refresh` on arrival, so the plan reads active without a "Check payment".
import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { appOrigin, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { chosen, firstMonthMemo, type PickBack, planOf, RETURN_LABEL, returnUrlFor, settle } from "@users/domain/business/plan/mod.ts";
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
  ) {}

  current(userId: string): Promise<UserPlan | null> {
    return this.plans.get(userId);
  }

  /**
   * @throws plan-unknown — not a selectable plan
   * @throws email-required — a paid pick with no email on the account
   * @throws payments-unavailable — the CRM did not answer
   */
  async choose(userId: string, planId: string, back: PickBack = "/settings"): Promise<UserPlan> {
    const plan = planOf(planId);
    const now = new Date().toISOString();
    if (plan.id === "free") return this.plans.put(chosen(userId, "free", now));

    const user = await this.users.get(userId);
    if (!user.email?.trim()) throw new EmailRequiredError();

    const { customerId } = await this.crm.ensure(userId);
    const { dueId } = await this.link.raiseDue({ customerId, amountCents: plan.priceCents, memo: firstMonthMemo(plan) });
    const { payUrl } = await this.link.mintPayLink({ customerId, dueId, returnUrl: returnUrlFor(appOrigin(), dueId, back), returnLabel: RETURN_LABEL });
    return this.plans.put(chosen(userId, plan.id as "monster" | "assist", now, { customerId, dueId, payUrl }));
  }

  /** a pending plan asks the CRM whether its due settled (what /plan/return does on arrival,
   *  REQ-059); anything else is answered as stored */
  async refresh(userId: string): Promise<UserPlan> {
    const plan = await this.plans.get(userId);
    if (!plan) throw Object.assign(new Error("plan-missing: nothing picked yet"), { status: 404 });
    if (plan.status !== "pending" || !plan.dueId) return plan;
    const open = await this.link.dueOpen(plan.dueId);
    const next = settle(plan, open, new Date().toISOString());
    return next === plan ? plan : this.plans.put(next);
  }
}
