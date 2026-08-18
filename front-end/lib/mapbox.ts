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
 *
 * P-38 — state bias + filter. When `opts.state` (two-letter code, e.g. "TX")
 * is provided:
 *   1. BIAS: the state code is appended to the geocode query ("1600
 *      Congress, TX") so Mapbox ranks in-state matches first, and the
 *      fetch limit is raised so filtering still leaves enough rows.
 *   2. FILTER: results are narrowed to that state whenever the filter
 *      leaves at least one match — so a user who just confirmed Texas
 *      never sees a Chicago/Ypsilanti list.
 *   3. FALLBACK: if Mapbox returns ZERO in-state rows for the biased query
 *      (rural queries, typos), the unfiltered biased results are returned
 *      instead of an empty list — out-of-state suggestions beat none, and
 *      the typed-text option (always rendered first by the caller) keeps
 *      any address enterable.
 */
export async function suggestAddresses(
  query: string,
  opts: { lang?: string; state?: string; signal?: AbortSignal } = {},
): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const stateCode = (opts.state ?? "").trim().toUpperCase();
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("q", stateCode ? `${q}, ${stateCode}` : q);
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("country", "us");
  url.searchParams.set("types", "address");
  url.searchParams.set("limit", stateCode ? "10" : "5");
  if (opts.lang) url.searchParams.set("language", opts.lang);
  url.searchParams.set("access_token", MAPBOX_TOKEN);
  try {
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) return [];
    const data = await res.json();
    const feats: unknown[] = Array.isArray(data?.features) ? data.features : [];
    const parsed = feats
      .map(parseFeature)
      .filter((s): s is AddressSuggestion => s !== null);
    if (!stateCode) return parsed;
    const inState = parsed.filter((s) => s.state === stateCode);
    return (inState.length > 0 ? inState : parsed).slice(0, 5);
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
