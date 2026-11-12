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
import { tFor } from "../../lib/i18n.ts";
import {
  resolveShareTarget,
  withSendLang,
} from "../../../shared/quote-flow/share-link.ts";

interface ShortLinkResolution {
  kind: "quote" | "invoice";
  id: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const code = ctx.params.code;
    const r = await ssrBackendGet<ShortLinkResolution>(
      `/s/${encodeURIComponent(code)}`,
    );
    if (!r.ok || !r.data) {
      return new Response(tFor("en", "shortlink.notFound"), { status: 404 });
    }
    // REQ-342 (M13): the link's ?lang= (the send language) rides onto the
    // document, so a cookie-less customer opens it in the language it was
    // sent in.
    const lang = new URL(ctx.req.url).searchParams.get("lang");
    const path = r.data.kind === "quote"
      ? resolveShareTarget({ id: r.data.id }, lang)
      : withSendLang(`/i/${r.data.id}`, lang);
    return new Response(null, { status: 302, headers: { location: path } });
  },
});
