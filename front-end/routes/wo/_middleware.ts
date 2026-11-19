import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";
import { loginRedirect } from "../../lib/login-redirect.ts";

// Auth gate only (same as /invoices): /wo/:id is the contractor's own
// work-order page — a work order has no customer-facing link (REQ-210).
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return loginRedirect(new URL(ctx.req.url));
  }
  ctx.state.user = user;
  return await ctx.next();
});
