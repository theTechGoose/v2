/**
 * REQ-131 — the settle watch: a minted due is asked, by the outbox's sweep, whether it settled —
 * until it does. Alex, 2026-11-02: the gateway approved his $99, the receipt had him on
 * /plan/return six seconds later, the CRM's deferred settlement landed half a minute after — the
 * one refresh read "still open" and nothing ever asked again. Now the sweep asks: open, the record
 * waits (CrmLeadCapture defers it on its backoff); settled, the plan the due was minted for is
 * active — the pending pick that carries it, or that pick restored when a later unpaid pick
 * replaced the record (three re-picks buried Alex's under a $399 first-month due). The rule is
 * the pure `watchOutcome`; this reads the CRM and the store and writes what it says.
 */
import { Injectable } from "#danet/core";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import {
  type WatchOutcome,
  watchOutcome,
} from "@users/domain/business/plan/mod.ts";
import type { UserPlan } from "@users/dto/plan.ts";

@Injectable()
export class SettleWatch {
  constructor(private plans: PlanStore, private link: PaymentsLink) {}

  /**
   * one look at the due: what it wrote, or `waiting` with nothing written
   * @throws payments-unavailable — the CRM did not answer: the sweep defers and asks again
   */
  async check(
    userId: string,
    dueId: string,
    pick: UserPlan | null,
  ): Promise<WatchOutcome> {
    if (!pick || !dueId) {
      return { kind: "nothing", why: "the watch names no pick" };
    }
    const open = await this.link.dueOpen(dueId);
    const current = await this.plans.get(userId);
    const outcome = watchOutcome(current, pick, open, new Date().toISOString());
    if (outcome.kind === "settled" || outcome.kind === "restored") {
      await this.plans.put(outcome.plan);
    }
    return outcome;
  }
}
