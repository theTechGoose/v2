import { define } from "../../utils.ts";
import { loadProfileGate } from "../../lib/auth.ts";

/** Auth + onboarding gate.
 *
 *  - No session → redirect to "/".
 *  - Session but missing name / businessName → redirect to
 *    /assistant?onboard=1 so Bossie can collect what we need before
 *    the customer-facing surfaces become reachable. /assistant and
 *    /settings keep their own (looser) gate so the user can complete
 *    onboarding or edit values manually.
 *  - Otherwise → populate ctx.state.user and continue.
 */
export const handler = define.middleware(async (ctx) => {
  const gate = await loadProfileGate(ctx.req);
  if (!gate.user) return new Response(null, { status: 302, headers: { Location: "/" } });
  if (!gate.isComplete) {
    return new Response(null, { status: 302, headers: { Location: "/assistant?onboard=1" } });
  }
  ctx.state.user = gate.user;
  return await ctx.next();
});
