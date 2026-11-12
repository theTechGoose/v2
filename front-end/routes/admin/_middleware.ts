import { h } from "preact";
import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";
import { adminGateForRequest } from "../../lib/admin-gate.ts";
import AdminGuideGate from "../../components/AdminGuideGate.tsx";

/** Auth + super-admin gate for /admin.
 *
 *  - No session → redirect to "/".
 *  - Logged in but NOT a super admin → redirect to "/dashboard" (no admin
 *    surface for them). The super-admin flag is read from the backend-resolved
 *    user (loadUser → GET /me), so the gate can't be spoofed client-side; the
 *    admin endpoints themselves re-check it server-side regardless.
 *  - REQ-376 (demo cycle 2, m20 + nc-second-demo) — unless the session is an
 *    impersonation (a demo started in another tab: impersonation is
 *    browser-wide, so this request resolves the CUSTOMER). Then a bare 302 to
 *    the customer's /dashboard silently made the tab the customer; it renders
 *    an interstitial instead — whom this browser guides, Back to the demo,
 *    Return to your account (to start another demo).
 */
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }
  if (user.superAdmin !== true) {
    const gate = await adminGateForRequest(ctx.req);
    if (gate) return await ctx.render(h(AdminGuideGate, { gate }));
    return new Response(null, {
      status: 302,
      headers: { Location: "/dashboard" },
    });
  }
  ctx.state.user = user;
  return await ctx.next();
});
