// REQ-054 — the plan a person picked: free, or a paid plan that is pending until the first
// month's due settles on the CRM's pay page, then active.
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

/** `POST /me/plan` body */
export interface ChoosePlanDto {
  planId: string;
}

export function parseChoosePlan(input: unknown): ChoosePlanDto {
  const planId = (input as { planId?: unknown } | null)?.planId;
  if (typeof planId !== "string" || !planId.trim()) {
    throw Object.assign(new Error("plan-id-required: body.planId is a plan id"), { status: 400 });
  }
  return { planId: planId.trim() };
}
