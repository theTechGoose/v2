import { define } from "../../utils.ts";
import { getSessionId, loadUser } from "../../lib/auth.ts";
import { ssrBackendPostAuthed } from "../../lib/backend-fetch.ts";
import type { UserPlan } from "../../clients/profile.ts";
import { backOf, pageAfterPick, payPageOf, pickErrorQuery } from "../../lib/plan-return.ts";

/**
 * POST /plan/pick (REQ-055/059) — a plan card is a form that posts here (`planId`, `back`), and
 * the answer is where the browser goes next: the CRM's pay page for a paid pick — THIS tab, a
 * real navigation, no popup and nothing for a script to open — or back to the page that showed
 * the cards for free (stored; the wizard resumes PAST the plan step, settings reads free). A pick
 * the backend refuses goes back saying why (`?plan=email-required` — a paid plan needs an email
 * on the account; `?plan=error` — the CRM did not answer). Without a session: the front page.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const planId = String(form.get("planId") ?? "");
    const back = backOf(String(form.get("back") ?? ""));
    const user = await loadUser(ctx.req);
    if (!user) return redirect("/");
    const r = await ssrBackendPostAuthed<UserPlan>("/me/plan", { planId, back }, getSessionId(ctx.req))
      .catch(() => ({ ok: false as const, status: 0 }));
    if (!r.ok || !r.data) return redirect(`${back}${pickErrorQuery(r.status)}`);
    return redirect(payPageOf(r.data) ?? pageAfterPick(back));
  },
});

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to } });
}
