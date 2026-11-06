import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";

/** REQ-187 — the stage needs a session (the presenter's, impersonating the customer); which demo it
 *  shows is the backend's call (`/demo-mode/active`), so no admin gate here: under impersonation
 *  the resolved user is the customer. */
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }
  ctx.state.user = user;
  return await ctx.next();
});
