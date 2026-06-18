import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";

/** Auth gate only — mirrors /dashboard.
 *
 *  - No session → redirect to "/".
 *  - Otherwise → populate ctx.state.user and continue.
 *
 *  This is the entry point for the (separate) accounts-manager view. It
 *  deliberately carries no onboarding/role logic yet — just the session
 *  check — so the page below can stay a blank slate.
 */
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }
  ctx.state.user = user;
  return await ctx.next();
});
