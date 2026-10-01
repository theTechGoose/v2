/**
 * REQ-055 — "upgrade to monster 99 ect should just be cards and open the payment page."
 *
 * A paid pick opens the CRM's pay page itself. The tab is opened INSIDE the click — before the
 * mint's await, because a tab opened after an await is a popup the browser blocks — and pointed
 * at the minted link when it arrives. Free opens nothing. A mint that fails, or that answers
 * without a pay page, closes the tab again. A browser that refused the tab (`open` gives null)
 * leaves the pending card's "Open the payment page" link as the way there.
 */
import type { PlanId, UserPlan } from "../clients/profile.ts";

/** What the helper needs of the tab it opened — a WindowProxy, or a test's stand-in. */
export interface PayTab {
  location: { href: string };
  close(): void;
}

export async function pickPlan(
  planId: PlanId,
  choose: (planId: PlanId) => Promise<UserPlan>,
  open: () => PayTab | null,
): Promise<UserPlan> {
  if (planId === "free") return await choose(planId);
  const tab = open();
  let plan: UserPlan;
  try {
    plan = await choose(planId);
  } catch (e) {
    tab?.close();
    throw e;
  }
  if (tab) {
    if (plan.status === "pending" && plan.payUrl) tab.location.href = plan.payUrl;
    else tab.close();
  }
  return plan;
}

/** The browser's tab: a blank one, severed from this window before it is pointed anywhere. */
export function openBlankTab(): PayTab | null {
  const tab = globalThis.open?.("", "_blank");
  if (!tab) return null;
  try {
    tab.opener = null;
  } catch {
    // a browser that refuses the assignment: the tab is still ours to point
  }
  return tab;
}
