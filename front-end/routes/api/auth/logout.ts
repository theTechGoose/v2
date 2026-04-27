/** POST /api/auth/logout — proxy to backend /auth/logout. Forwards Set-Cookie. */
import { define } from "../../../utils.ts";

const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    const cookie = ctx.req.headers.get("cookie") ?? "";
    let res: Response;
    try {
      res = await fetch(`${BACKEND_URL}/auth/logout`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
      });
    } catch {
      // Backend down — still clear the cookie locally so /dashboard stops redirecting.
      const headers = new Headers({ "content-type": "application/json" });
      headers.set("set-cookie", "pm_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }
    const headers = new Headers({ "content-type": "application/json" });
    const upstream = res.headers.get("set-cookie");
    if (upstream) headers.set("set-cookie", upstream);
    return new Response(await res.text() || JSON.stringify({ ok: true }), { status: res.status, headers });
  },
});
