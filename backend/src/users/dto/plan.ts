// REQ-054 — the plan a person picked: free, or a paid plan that is pending until the first
// month's due settles on the CRM's pay page, then active.
import { type PickBack, pickBackOf } from "@users/domain/business/plan/mod.ts";
export type PlanId = "free" | "monster" | "assist";
export type PlanStatus = "free" | "pending" | "active";

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
  payUrl?: string;
  updatedAt: string;
}

/** `POST /me/plan` body — `back`: the page the pick came from (REQ-059: where the receipt brings
 *  the person back to); anything but a cards page reads as settings */
export interface ChoosePlanDto {
  planId: string;
  back: PickBack;
}

export function parseChoosePlan(input: unknown): ChoosePlanDto {
  const body = input as { planId?: unknown; back?: unknown } | null;
  const planId = body?.planId;
  if (typeof planId !== "string" || !planId.trim()) {
    throw Object.assign(new Error("plan-id-required: body.planId is a plan id"), { status: 400 });
  }
  return { planId: planId.trim(), back: pickBackOf(body?.back) };
}
