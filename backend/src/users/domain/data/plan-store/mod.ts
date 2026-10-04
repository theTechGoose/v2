// REQ-054 — the plan a person picked, one record per user.
//   ["plan", userId] → UserPlan
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type { UserPlan } from "@users/dto/plan.ts";

@Injectable()
export class PlanStore {
  async get(userId: string): Promise<UserPlan | null> {
    const kv = await getKv();
    return (await kv.get<UserPlan>(["plan", userId])).value ?? null;
  }

  async put(plan: UserPlan): Promise<UserPlan> {
    const kv = await getKv();
    await kv.set(["plan", plan.userId], plan);
    return plan;
  }
}
