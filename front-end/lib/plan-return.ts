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
  // REQ-061 — a past-due month has a pay page of its own, the same way
  return (plan.status === "pending" || plan.status === "past_due") && plan.payUrl ? plan.payUrl : null;
}

// ---- REQ-106 — the pick answers at once; the page comes after -------------------------------
// Raphael, 2026-10-20: "when i click a plan in the onboarding flow the payment link takes FOREVER
// to load, can we speed it up and keep the exact same result in the crm? i dont care if it happens
// asyncronously … what i care about is that the user experience is good." A paid pick is pending
// with no page yet; the browser goes to the hand-off page (/plan/pay), which polls the plan and
// moves on the moment the page is on the record.

type PlanLike = Pick<UserPlan, "status" | "payUrl" | "payLinkError">;

/** what a pending pick is, read from its record: being prepared, ready, refused by name, or the
 *  link builder not answering yet; none for anything that is not pending */
export type Handoff = "preparing" | "ready" | "merchant-unknown" | "unavailable" | "none";
export function handoffOf(plan: PlanLike | null | undefined): Handoff {
  if (!plan || plan.status !== "pending") return "none";
  if (plan.payUrl) return "ready";
  if (plan.payLinkError === "merchant-unknown") return "merchant-unknown";
  if (plan.payLinkError === "payments-unavailable") return "unavailable";
  return "preparing";
}

/** the hand-off page, carrying the page the pick came from */
export function handoffPage(back: PickBack): string {
  return `/plan/pay?${new URLSearchParams({ back })}`;
}

/** where a pick sends the browser: the hand-off page while the page is being prepared, straight
 *  to the page when it is already there, back with the reason when the CRM refused the name, and
 *  the page after a pick for free */
export function afterPickOf(plan: PlanLike | null | undefined, back: PickBack): string {
  const h = handoffOf(plan);
  if (h === "ready") return plan!.payUrl!;
  if (h === "preparing" || h === "unavailable") return handoffPage(back);
  if (h === "merchant-unknown") return `${back}?plan=merchant-unknown`;
  return pageAfterPick(back);
}

/** what the hand-off page does with the plan it just read: nothing while the page is being
 *  prepared (ask again), the page the moment it is there, back with the reason on a refusal, on
 *  to the page after a pick when the plan is no longer pending (picked free elsewhere, or active) */
export function handoffNext(plan: PlanLike | null | undefined, back: PickBack): string | null {
  const h = handoffOf(plan);
  if (h === "preparing" || h === "unavailable") return null;
  return afterPickOf(plan, back);
}

/** how the cards pages show the plan: active as active; a pending pick as its page (Resume
 *  payment), as being prepared (the hand-off page), or as the cards again after a refusal */
export type PlanView = "active" | "pay" | "preparing" | "cards";
export function planViewOf(plan: PlanLike | null | undefined): PlanView {
  if (plan?.status === "active") return "active";
  const h = handoffOf(plan);
  if (h === "ready") return "pay";
  if (h === "preparing" || h === "unavailable") return "preparing";
  return "cards";
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

/** merchant-unknown — REQ-101: the pick named a merchant account the CRM has no record of */
export type PickError = "email-required" | "merchant-unknown" | "error";

/** the query a failed pick comes back with (`?plan=…`), and what a page reads from it */
export function pickErrorQuery(status: number): string {
  return `?plan=${status === 409 ? "email-required" : status === 422 ? "merchant-unknown" : "error"}`;
}
export function pickErrorOf(search: string): PickError | null {
  const v = new URLSearchParams(search).get("plan");
  return v === "email-required" || v === "merchant-unknown" || v === "error" ? v : null;
}

/**
 * the stand-in pay page's way back (REQ-057's /pay/fake): the return address the link carried,
 * with the charge and the due on it the way the CRM's receipt does; settings when there is none
 */
/** REQ-064 — the merchant account named on /plan/test?merchant=<name>: a slug (lowercase letters,
 *  digits, dashes, up to 40), lowercased; anything else reads as none (the CRM's default) */
export function merchantOf(raw: string): string {
  const v = raw.trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(v) ? v : "";
}

export function fakeReturnHref(returnUrl: string, dueId: string): string {
  if (!returnUrl) return "/settings";
  const url = new URL(returnUrl);
  if (!url.searchParams.has("charge")) url.searchParams.set("charge", "fake");
  if (!url.searchParams.has("due")) url.searchParams.set("due", dueId);
  return url.toString();
}
