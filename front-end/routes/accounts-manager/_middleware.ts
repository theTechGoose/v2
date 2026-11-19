import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";
import { loginRedirect } from "../../lib/login-redirect.ts";

/** Auth gate only — mirrors /dashboard.
 *
 *  - No session → /login?next=<the page asked for> (REQ-1153).
 *  - Otherwise → populate ctx.state.user and continue.
 *
 *  This is the entry point for the (separate) accounts-manager view. It
 *  deliberately carries no onboarding/role logic yet — just the session
 *  check — so the page below can stay a blank slate.
 */
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return loginRedirect(new URL(ctx.req.url));
  }
  ctx.state.user = user;
  return await ctx.next();
});
