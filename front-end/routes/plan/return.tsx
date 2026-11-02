import { define } from "../../utils.ts";
import { getSessionId, loadUser } from "../../lib/auth.ts";
import { ssrBackendGetAuthed } from "../../lib/backend-fetch.ts";
import type { UserPlan } from "../../clients/profile.ts";
import { backOf, pageAfterPick } from "../../lib/plan-return.ts";
import { subscribeMarker } from "../../../shared/meta-pixel/pixel.ts";

/**
 * /plan/return (REQ-059) — where the CRM's pay page brings the person back after the card
 * lands: the link the backend minted names this page (users/domain/business/plan.ts
 * returnUrlFor: the due and the page the pick came from), and the receipt follows it with
 * `charge` and `due` on the query. The person continues where they were — the wizard past its
 * plan step, or settings. No page to look at: it only redirects. Without a session it goes to the
 * front page. REQ-133 — Raphael, 2026-11-02: "The front end should not be doing any business
 * logic, only presentation logic." Nothing is pressed here: the backend reads a pending plan
 * against the CRM on every read of it (and the CRM tells it when the due settles); this page only
 * READS the plan, to know which pixel the landing page fires (REQ-080).
 */
export default define.page(async function PlanReturn(ctx) {
  const user = await loadUser(ctx.req);
  if (!user) return redirect("/");
  const read = await ssrBackendGetAuthed<UserPlan | null>("/me/plan", getSessionId(ctx.req)).catch(() => null);
  const to = new URL(pageAfterPick(backOf(ctx.url.searchParams.get("back") ?? "")), ctx.url);
  // REQ-080: the plan reads active — the page it lands on fires the ads' Subscribe, keyed by the due
  const marker = read?.ok && read.data ? subscribeMarker(read.data) : null;
  if (marker) to.searchParams.set("px", marker);
  return redirect(to.pathname + to.search);
});

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}
