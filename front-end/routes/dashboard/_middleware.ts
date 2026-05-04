import { define } from "../../utils.ts";
import { loadProfileGate } from "../../lib/auth.ts";

/** Auth + onboarding gate.
 *
 *  - No session → redirect to "/".
 *  - Session but missing name OR businessName → redirect to
 *    /assistant?onboard=1 so Bossie can collect those before the
 *    customer-facing surfaces become reachable.
 *  - Missing `state` alone is NOT a hard block on the dashboard.
 *    The user can browse freely; state is only required when they
 *    actually go to send a contract (the wizard's governing-state
 *    step re-asks if it's still missing at that point).
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
