/**
 * Server-side Mapbox forward-geocode proxy. The Mapbox token lives ONLY in
 * the MAPBOX_TOKEN env var (never in source, never in the client bundle) —
 * the browser calls this same-origin route and the token is attached here.
 * A literal route wins over the generic /api/[...path] backend proxy.
 */
import { define } from "../../utils.ts";

const GEOCODE_URL = "https://api.mapbox.com/search/geocode/v6/forward";

export const handler = define.handlers({
  async GET(ctx) {
    const token = Deno.env.get("MAPBOX_TOKEN");
    const q = ctx.url.searchParams.get("q")?.trim() ?? "";
    if (!token || q.length < 3) {
      return new Response(JSON.stringify({ features: [] }), {
        headers: { "content-type": "application/json" },
      });
    }
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("q", q);
    url.searchParams.set("autocomplete", "true");
    url.searchParams.set("country", "us");
    url.searchParams.set("types", "address");
    url.searchParams.set(
      "limit",
      ctx.url.searchParams.get("limit") === "10" ? "10" : "5",
    );
    const lang = ctx.url.searchParams.get("language");
    if (lang) url.searchParams.set("language", lang);
    url.searchParams.set("access_token", token);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return new Response(JSON.stringify({ features: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(await res.text(), {
        headers: { "content-type": "application/json" },
      });
    } catch {
      return new Response(JSON.stringify({ features: [] }), {
        headers: { "content-type": "application/json" },
      });
    }
  },
});
