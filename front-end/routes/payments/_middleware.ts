import { define } from "../../utils.ts";
import { loadProfileGate } from "../../lib/auth.ts";

export const handler = define.middleware(async (ctx) => {
  const gate = await loadProfileGate(ctx.req);
  if (!gate.user) return new Response(null, { status: 302, headers: { Location: "/" } });
  if (!gate.isComplete) {
    return new Response(null, { status: 302, headers: { Location: "/assistant?onboard=1" } });
  }
  ctx.state.user = gate.user;
  return await ctx.next();
});
