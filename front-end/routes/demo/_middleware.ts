import { define } from "../../utils.ts";
import { loadUser } from "../../lib/auth.ts";
import { presenterLangForRequest } from "../../lib/presenter-lang.ts";

/** REQ-187 — the stage needs a session (the presenter's, impersonating the customer); which demo it
 *  shows is the backend's call (`/demo-mode/active`), so no admin gate here: under impersonation
 *  the resolved user is the customer.
 *  REQ-812 (demo-loop dm1, p2): so the page's language is the PRESENTER's (REQ-341), set on
 *  ctx.state.lang for the whole page — the app shell's <html lang>, boot language and HtmlLang
 *  (whose on-mount title heal would otherwise turn the title into the customer's language) as
 *  well as the route's DocTitle and the DemoStage island. */
export const handler = define.middleware(async (ctx) => {
  const user = await loadUser(ctx.req);
  if (!user) {
    return new Response(null, { status: 302, headers: { Location: "/" } });
  }
  ctx.state.user = user;
  ctx.state.lang = await presenterLangForRequest(ctx.req, user);
  return await ctx.next();
});
