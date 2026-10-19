import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";
import { openOnboardingQuestions } from "../../lib/onboarding-gate.ts";

/** The dashboard's gate.
 *
 *  - No session → redirect to "/".
 *  - REQ-091: an onboarding question still open → redirect to /welcome, which
 *    resumes at the first open one. Onboarding happens until every question
 *    is answered; Skip only puts a question off, so the dashboard — the app's
 *    front door after a code — brings the wizard back. A profile that cannot
 *    be read lets the person through: two pages that cannot load would loop.
 *  - Otherwise → populate ctx.state.user and continue.
 *
 *  The other app pages (the assistant, quotes, settings …) stay reachable: the
 *  wizard's own side trips (the pay page, the sample quote) and "Skip setup
 *  for now" land there.
 */
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }
  const open = await openOnboardingQuestions(ctx.req);
  if (open && open.length > 0) {
    return new Response(null, { status: 302, headers: { Location: "/welcome" } });
  }
  ctx.state.user = user;
  return await ctx.next();
});
