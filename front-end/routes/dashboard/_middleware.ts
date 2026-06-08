import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";

/** Auth gate only.
 *
 *  - No session → redirect to "/".
 *  - Otherwise → populate ctx.state.user and continue.
 *
 *  Onboarding info (name / businessName / state / address) is NOT a
 *  navigation prerequisite. The assistant already lets a user draft and
 *  lock a quote without any of it, so gating the rest of the app behind it
 *  only produced limbo: incomplete users got bounced to
 *  /assistant?onboard=1 and stranded on an empty onboarding chat. Setup is
 *  now collected as a non-blocking nudge — the dashboard's SetupChecklist
 *  surfaces name + business + the rest — and individual fields are re-asked
 *  at the one moment they're actually required (e.g. the contract wizard's
 *  governing-state step).
 */
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }
  ctx.state.user = user;
  return await ctx.next();
});
