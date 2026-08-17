/**
 * Mapbox forward-geocoding helper for US address autocomplete.
 *
 * The token is a publishable (pk.) Mapbox token — designed to ship in
 * client-side code. Scope/rotate it from the Mapbox dashboard if needed.
 */
const MAPBOX_TOKEN =
  "REDACTED_ROTATED_TOKEN";

const GEOCODE_URL = "https://api.mapbox.com/search/geocode/v6/forward";

export interface AddressSuggestion {
  /** One-line display label, e.g. "1600 Pennsylvania Ave, Lorain, OH 44052" */
  label: string;
  /** Street line incl. number, e.g. "1600 Pennsylvania Ave" */
  street: string;
  city: string;
  /** Two-letter state code when Mapbox provides one (e.g. "OH") */
  state: string;
  postal: string;
}

/**
 * Autocomplete US street addresses. Returns [] for short queries and on any
 * API failure — autocomplete is a convenience layer, never an error surface.
 */
export async function suggestAddresses(
  query: string,
  opts: { lang?: string; signal?: AbortSignal } = {},
): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("country", "us");
  url.searchParams.set("types", "address");
  url.searchParams.set("limit", "5");
  if (opts.lang) url.searchParams.set("language", opts.lang);
  url.searchParams.set("access_token", MAPBOX_TOKEN);
  try {
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) return [];
    const data = await res.json();
    const feats: unknown[] = Array.isArray(data?.features) ? data.features : [];
    return feats
      .map(parseFeature)
      .filter((s): s is AddressSuggestion => s !== null);
  } catch (err) {
    // Surface aborts so callers can ignore stale requests; swallow the rest.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return [];
  }
}

// deno-lint-ignore no-explicit-any
function parseFeature(f: any): AddressSuggestion | null {
  const p = f?.properties;
  const ctx = p?.context ?? {};
  const street: string = ctx.address?.name ?? p?.name ?? "";
  if (!street) return null;
  const city: string = ctx.place?.name ?? "";
  const state: string = ctx.region?.region_code ?? "";
  const postal: string = ctx.postcode?.name ?? "";
  const label = [street, city, [state, postal].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return { label, street, city, state, postal };
}
