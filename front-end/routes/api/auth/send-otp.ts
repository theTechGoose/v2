/**
 * POST /api/auth/send-otp — proxy to backend /auth/send-otp.
 * Adds no logic. Forwards body, surfaces backend errors verbatim, and
 * surfaces "backend unreachable" as 502 so the client can render a real message.
 */
import { define } from "../../../utils.ts";

const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "http://localhost:3000";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.text();
    try {
      const res = await fetch(`${BACKEND_URL}/auth/send-otp`, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body,
      });
      return new Response(await res.text(), {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "backend_unreachable" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
});
