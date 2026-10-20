/**
 * REQ-106 — Raphael, 2026-10-20: "when i click a plan in the onboarding flow the payment link
 * takes FOREVER to load, can we speed it up and keep the exact same result in the crm? i dont care
 * if it happens asyncronously it takes that amount of time anyway so as long as it ends up where
 * its going fine. what i care about is that the user experience is good."
 *
 * The three CRM calls a paid pick used to wait on — the account's customer (CrmCustomerSync.ensure,
 * REQ-058), the first month as a due, the pay link that collects it (REQ-054/059) — made by the
 * lead outbox's sweep after the reply, in the same order with the same payloads, and written on the
 * plan's record (`minted`): the pay page the hand-off page (/plan/pay) is waiting for. The pick
 * itself (ChoosePlan.choose) stores the pending plan with the account decided (REQ-100) and
 * enqueues this (CrmLeadCapture.enqueuePayLink).
 *
 * The CRM's refusal by name (REQ-101, 422) is final: read on the record as merchant-unknown, the
 * sweep's record cleared, the person picks again. Any other failure marks the record
 * payments-unavailable (the hand-off page says it is taking longer) and is thrown, so the sweep
 * defers and retries — the whole mint again, which the CRM takes: it upserts the customer by ref.
 * A newer pick made meanwhile is never overwritten by the stale page (`samePick`): the re-marked
 * record carries the newer pick on the sweep that follows.
 */
import { Injectable } from "#danet/core";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { appOrigin, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { firstMonthMemo, isPreparing, minted, payLinkFailed, type PickBack, planOf, RETURN_LABEL, returnUrlFor, samePick } from "@users/domain/business/plan/mod.ts";
import type { UserPlan } from "@users/dto/plan.ts";

@Injectable()
export class PayLinkMint {
  constructor(private plans: PlanStore, private link: PaymentsLink, private crm: CrmCustomerSync) {}

  /**
   * the account's pending pick, minted: the plan as it stands after, or as it was when there was
   * nothing to mint (free, active, a page already there)
   * @throws payments-unavailable — the CRM did not answer: the sweep defers and retries
   */
  async mint(userId: string, back: PickBack): Promise<UserPlan | null> {
    const pick = await this.plans.get(userId);
    if (!pick || !isPreparing(pick) || !pick.merchant) return pick;
    const merchant = pick.merchant;
    const pricing = planOf(pick.planId);
    try {
      const { customerId } = await this.crm.ensure(userId);
      const { dueId } = await this.link.raiseDue({ customerId, amountCents: pricing.priceCents, memo: firstMonthMemo(pricing) });
      const { payUrl } = await this.link.mintPayLink({ customerId, dueId, returnUrl: returnUrlFor(appOrigin(), dueId, back), returnLabel: RETURN_LABEL, merchant });
      return await this.write(userId, pick, (current) => minted(current, { customerId, dueId, payUrl, merchant }, new Date().toISOString()));
    } catch (e) {
      const refused = (e as { status?: number }).status === 422; // REQ-101 — a name the CRM has no account for
      await this.write(userId, pick, (current) => payLinkFailed(current, refused ? "merchant-unknown" : "payments-unavailable", new Date().toISOString()));
      if (refused) return await this.plans.get(userId); // final: the record is done, the person picks again
      throw e;
    }
  }

  /** the record as it stands now, written only while it is still the pick this mint set out for */
  private async write(userId: string, pick: UserPlan, next: (current: UserPlan) => UserPlan): Promise<UserPlan | null> {
    const current = await this.plans.get(userId);
    if (!current || !samePick(current, pick)) return current; // a newer pick: this result is not its page
    return await this.plans.put(next(current));
  }
}
