import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";

/** Auth + super-admin gate for /admin.
 *
 *  - No session → redirect to "/".
 *  - Logged in but NOT a super admin → redirect to "/dashboard" (no admin
 *    surface for them). The super-admin flag is read from the backend-resolved
 *    user (loadUser → GET /me), so the gate can't be spoofed client-side; the
 *    admin endpoints themselves re-check it server-side regardless.
 */
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }
  if (user.superAdmin !== true) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard" },
    });
  }
  ctx.state.user = user;
  return await ctx.next();
});
