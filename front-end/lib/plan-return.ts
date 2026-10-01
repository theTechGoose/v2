/**
 * REQ-059 — "v2 should redirect to the ui … the payments should be seamless between both apps."
 *
 * A plan card is a form: picking posts to /plan/pick, and the answer is a REDIRECT — to the
 * CRM's pay page for a paid pick (this tab, no popup), back to the page for free. The link the
 * backend minted carries the way back (/plan/return, naming the due), so the receipt brings the
 * person home with the plan already active. Pure helpers of that route and of the stand-in page.
 */
import type { UserPlan } from "../clients/profile.ts";

/** where a pick sends the browser: the pay page for a paid pick, nowhere (null) for free */
export function payPageOf(plan: Pick<UserPlan, "status" | "payUrl">): string | null {
  return plan.status === "pending" && plan.payUrl ? plan.payUrl : null;
}

/** the pages that show the cards — the only places a pick goes back to */
const BACKS = ["/welcome", "/settings"] as const;
export type PickBack = typeof BACKS[number];

/** where a pick goes back to when there is no page to go to: the page it came from, settings otherwise */
export function backOf(raw: string): PickBack {
  return (BACKS as readonly string[]).includes(raw) ? raw as PickBack : "/settings";
}

/** the wizard's page after a pick: resume PAST the plan step (free stored, or the receipt back
 *  with the plan active) instead of at the first step the person skipped */
export function pageAfterPick(back: PickBack): string {
  return back === "/welcome" ? "/welcome?after=plan" : back;
}
export function resumesAfterPlan(search: string): boolean {
  return new URLSearchParams(search).get("after") === "plan";
}

export type PickError = "email-required" | "error";

/** the query a failed pick comes back with (`?plan=…`), and what a page reads from it */
export function pickErrorQuery(status: number): string {
  return `?plan=${status === 409 ? "email-required" : "error"}`;
}
export function pickErrorOf(search: string): PickError | null {
  const v = new URLSearchParams(search).get("plan");
  return v === "email-required" || v === "error" ? v : null;
}

/**
 * the stand-in pay page's way back (REQ-057's /pay/fake): the return address the link carried,
 * with the charge and the due on it the way the CRM's receipt does; settings when there is none
 */
export function fakeReturnHref(returnUrl: string, dueId: string): string {
  if (!returnUrl) return "/settings";
  const url = new URL(returnUrl);
  if (!url.searchParams.has("charge")) url.searchParams.set("charge", "fake");
  if (!url.searchParams.has("due")) url.searchParams.set("due", dueId);
  return url.toString();
}
