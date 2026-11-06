import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";

// Auth gate only (same as /invoices): /wo/:id is the contractor's own
// work-order page — a work order has no customer-facing link (REQ-210).
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }
  ctx.state.user = user;
  return await ctx.next();
});
