import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";
import { loginRedirect } from "../../lib/login-redirect.ts";

export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return loginRedirect(new URL(ctx.req.url));
  }
  ctx.state.user = user;
  return await ctx.next();
});
