import { define } from "../../utils.ts";
import { getSessionId, loadUser } from "../../lib/auth.ts";
import { ssrBackendPostAuthed } from "../../lib/backend-fetch.ts";
import type { UserPlan } from "../../clients/profile.ts";
import { backOf, pageAfterPick } from "../../lib/plan-return.ts";
import { subscribeMarker } from "../../../shared/meta-pixel/pixel.ts";

/**
 * /plan/return (REQ-059) — where the CRM's pay page brings the person back after the card
 * lands: the link the backend minted names this page (users/domain/business/plan.ts
 * returnUrlFor: the due and the page the pick came from), and the receipt follows it with
 * `charge` and `due` on the query. Arriving here IS the "Check payment": the plan is refreshed
 * against the CRM (the due settled → active) and the person continues where they were — the
 * wizard past its plan step, or settings. No page to look at: it only redirects. Without a
 * session it goes to the front page.
 */
export default define.page(async function PlanReturn(ctx) {
  const user = await loadUser(ctx.req);
  if (!user) return redirect("/");
  // best effort: a CRM hiccup here leaves the plan pending; the page still offers "Resume payment"
  const refreshed = await ssrBackendPostAuthed<UserPlan>("/me/plan/refresh", {}, getSessionId(ctx.req)).catch(() => null);
  const to = new URL(pageAfterPick(backOf(ctx.url.searchParams.get("back") ?? "")), ctx.url);
  // REQ-080: the plan came back active — the page it lands on fires the ads' Subscribe, keyed by the due
  const marker = refreshed?.ok && refreshed.data ? subscribeMarker(refreshed.data) : null;
  if (marker) to.searchParams.set("px", marker);
  return redirect(to.pathname + to.search);
});

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}
