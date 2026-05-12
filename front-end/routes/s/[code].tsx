/**
 * /s/:code — customer-facing shortlink redirect.
 *
 * Resolves the code against the backend's public resolver, then 302s
 * to the canonical public surface (/q/:id, /c/:id, /i/:id). On unknown
 * code, falls through to a 404 page so we never leak a stack trace to
 * customers who clicked a stale SMS.
 */
import { define } from "../../utils.ts";
import { ssrBackendGet } from "../../lib/backend-fetch.ts";

interface ShortLinkResolution {
  kind: "quote" | "contract" | "invoice";
  id: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const code = ctx.params.code;
    const r = await ssrBackendGet<ShortLinkResolution>(`/s/${encodeURIComponent(code)}`);
    if (!r.ok || !r.data) {
      return new Response("not found", { status: 404 });
    }
    const path = r.data.kind === "quote"
      ? `/q/${r.data.id}`
      : r.data.kind === "contract"
      ? `/c/${r.data.id}`
      : `/i/${r.data.id}`;
    return new Response(null, { status: 302, headers: { location: path } });
  },
});
