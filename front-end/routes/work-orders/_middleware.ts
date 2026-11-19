import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";
import { loginRedirect } from "../../lib/login-redirect.ts";

// Auth gate only (same as /invoices): a valid session is required, onboarding
// completeness is not — the dashboard's SetupChecklist nudges, never walls.
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return loginRedirect(new URL(ctx.req.url));
  }
  ctx.state.user = user;
  return await ctx.next();
});
