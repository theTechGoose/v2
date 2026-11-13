import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";

// Auth gate only — a valid session is required, but onboarding info
// (name / business name) is NOT. Users reach every surface and finish setup
// whenever; the dashboard's SetupChecklist nudges them. We used to bounce
// incomplete profiles to /assistant?onboard=1, which trapped anyone who'd
// drafted a quote without onboarding (the assistant never gated that) and
// dumped them into an empty onboarding chat. The collector is a nudge now,
// not a wall.
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }
  ctx.state.user = user;
  return await ctx.next();
});
