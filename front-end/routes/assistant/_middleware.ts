import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";

export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) return new Response(null, { status: 302, headers: { Location: "/" } });
  ctx.state.user = user;
  return await ctx.next();
});
