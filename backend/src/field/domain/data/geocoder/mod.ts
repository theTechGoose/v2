/**
 * REQ-139 — address → coordinates, called ONCE per address.
 * REQ-318's switch: on the real deploy (`onRealDeploy()`) the Mapbox geocoder
 * (MAPBOX_TOKEN required); otherwise a deterministic fake, so a dev box, the
 * gate and the stories never leave the machine.
 */
import { Injectable } from "#danet/core";
import { onRealDeploy } from "@core/business/real-deploy/mod.ts";
import { FieldError } from "@field/dto/field.ts";

export interface Geocoder {
  geocode(address: string): Promise<{ lat: number; lng: number }>;
}

/** hand-placed demo addresses (Myrtle Beach), so seeded data clusters the way a real town does */
const KNOWN: Record<string, { lat: number; lng: number }> = {
  "4505 socastee blvd": { lat: 33.6835, lng: -79.0074 },
  "4601 dick pond rd": { lat: 33.6795, lng: -79.0035 },
  "6219 forestbrook rd": { lat: 33.7010, lng: -78.9960 },
  "3110 oak st": { lat: 33.6880, lng: -79.0010 },
  "4000 carolina forest blvd": { lat: 33.7530, lng: -78.9410 },
  "2201 river oaks dr": { lat: 33.7450, lng: -78.9300 },
  "4725 jordan ridge ct": { lat: 33.7590, lng: -78.9480 },
  "1200 n ocean blvd": { lat: 33.6945, lng: -78.8780 },
  "900 broadway st": { lat: 33.6900, lng: -78.8900 },
  "1600 kings hwy": { lat: 33.6990, lng: -78.8840 },
  "115 surfside dr": { lat: 33.6060, lng: -78.9730 },
};

/** REQ-288 — each state's capital, so the fake puts an address that names a
 *  state in that state (an Austin, TX business is not drawn in South Carolina).
 *  SC keeps the Myrtle Beach box the seeded data lives in. */
const STATE_ANCHOR: Record<string, { lat: number; lng: number }> = {
  AL: { lat: 32.377, lng: -86.300 },
  AK: { lat: 58.302, lng: -134.420 },
  AZ: { lat: 33.448, lng: -112.097 },
  AR: { lat: 34.747, lng: -92.289 },
  CA: { lat: 38.577, lng: -121.494 },
  CO: { lat: 39.739, lng: -104.990 },
  CT: { lat: 41.764, lng: -72.682 },
  DE: { lat: 39.157, lng: -75.520 },
  DC: { lat: 38.895, lng: -77.036 },
  FL: { lat: 30.438, lng: -84.281 },
  GA: { lat: 33.749, lng: -84.388 },
  HI: { lat: 21.307, lng: -157.857 },
  ID: { lat: 43.618, lng: -116.200 },
  IL: { lat: 39.798, lng: -89.654 },
  IN: { lat: 39.768, lng: -86.163 },
  IA: { lat: 41.591, lng: -93.604 },
  KS: { lat: 39.048, lng: -95.678 },
  KY: { lat: 38.187, lng: -84.875 },
  LA: { lat: 30.457, lng: -91.187 },
  ME: { lat: 44.307, lng: -69.782 },
  MD: { lat: 38.979, lng: -76.491 },
  MA: { lat: 42.358, lng: -71.064 },
  MI: { lat: 42.734, lng: -84.555 },
  MN: { lat: 44.955, lng: -93.102 },
  MS: { lat: 32.304, lng: -90.182 },
  MO: { lat: 38.579, lng: -92.173 },
  MT: { lat: 46.586, lng: -112.018 },
  NE: { lat: 40.808, lng: -96.700 },
  NV: { lat: 39.164, lng: -119.766 },
  NH: { lat: 43.207, lng: -71.538 },
  NJ: { lat: 40.220, lng: -74.770 },
  NM: { lat: 35.682, lng: -105.940 },
  NY: { lat: 42.653, lng: -73.757 },
  NC: { lat: 35.780, lng: -78.639 },
  ND: { lat: 46.821, lng: -100.783 },
  OH: { lat: 39.961, lng: -82.999 },
  OK: { lat: 35.492, lng: -97.503 },
  OR: { lat: 44.938, lng: -123.030 },
  PA: { lat: 40.264, lng: -76.884 },
  RI: { lat: 41.831, lng: -71.415 },
  SD: { lat: 44.367, lng: -100.346 },
  TN: { lat: 36.166, lng: -86.784 },
  TX: { lat: 30.267, lng: -97.743 },
  UT: { lat: 40.777, lng: -111.888 },
  VT: { lat: 44.262, lng: -72.581 },
  VA: { lat: 37.539, lng: -77.434 },
  WA: { lat: 47.036, lng: -122.905 },
  WV: { lat: 38.336, lng: -81.612 },
  WI: { lat: 43.075, lng: -89.384 },
  WY: { lat: 41.140, lng: -104.820 },
};

/** the state an address names after a comma ("…, Austin, TX 78701" → "TX"), or
 *  a line that IS a state, optionally with its ZIP ("FL", "FL 33101" — REQ-747:
 *  onboarding saves only the state); else null — a bare street's suffix
 *  ("2 Elm Ct") is not a state */
function stateOf(key: string): string | null {
  const m = key.match(/,[^,]*\b([a-z]{2})(?:\s+\d{5}(?:-?\d{4})?)?$/) ??
    key.match(/^([a-z]{2})(?:\s+\d{5}(?:-?\d{4})?)?$/);
  const code = m?.[1].toUpperCase();
  return code && STATE_ANCHOR[code] ? code : null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export class FakeGeocoder implements Geocoder {
  calls = 0;
  geocode(address: string): Promise<{ lat: number; lng: number }> {
    this.calls++;
    const key = address.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ")
      .trim();
    for (const [k, v] of Object.entries(KNOWN)) {
      if (key.startsWith(k)) return Promise.resolve(v);
    }
    const a = hash(key), b = hash(key + "|lng");
    // the raw address: its commas mark where the state is
    const state = stateOf(address.toLowerCase().replace(/\s+/g, " ").trim());
    if (state && state !== "SC") {
      const at = STATE_ANCHOR[state];
      return Promise.resolve({
        lat: at.lat + (a - 0.5) * 0.18,
        lng: at.lng + (b - 0.5) * 0.16,
      });
    }
    return Promise.resolve({ lat: 33.60 + a * 0.18, lng: -79.02 + b * 0.16 });
  }
}

export class MapboxGeocoder implements Geocoder {
  constructor(private token: string) {}
  async geocode(address: string): Promise<{ lat: number; lng: number }> {
    const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${
      encodeURIComponent(address)
    }&country=us&limit=1&access_token=${this.token}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`mapbox ${r.status}`);
    const j = await r.json();
    const [lng, lat] = j.features?.[0]?.geometry?.coordinates ?? [];
    if (typeof lat !== "number") {
      throw new Error("mapbox: no result for that address");
    }
    return { lat, lng };
  }
}

/** the module's one geocoder — injectable so a test can read the fake's call count */
@Injectable()
export class FieldGeocoder implements Geocoder {
  /** null on the real deploy without MAPBOX_TOKEN — the app still boots; a
   *  geocode then answers 503 instead of the whole app failing to start */
  readonly inner: Geocoder | null;
  constructor() {
    if (onRealDeploy()) {
      const token = Deno.env.get("MAPBOX_TOKEN");
      this.inner = token ? new MapboxGeocoder(token) : null;
      if (!token) {
        console.error(
          "[field] MAPBOX_TOKEN is not set — subscriptions cannot be geocoded until it is",
        );
      }
    } else this.inner = new FakeGeocoder();
  }
  geocode(address: string) {
    if (!this.inner) {
      throw new FieldError("geocoding is not configured (MAPBOX_TOKEN)", 503);
    }
    return this.inner.geocode(address);
  }
  get fake(): FakeGeocoder | null {
    return this.inner instanceof FakeGeocoder ? this.inner : null;
  }
}
