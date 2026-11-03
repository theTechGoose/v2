/**
 * REQ-139 — address → coordinates, called ONCE per address.
 * REQ-318's switch: on the real deploy (`onRealDeploy()`) the Mapbox geocoder
 * (MAPBOX_TOKEN required); otherwise a deterministic fake, so a dev box, the
 * gate and the stories never leave the machine.
 */
import { Injectable } from "#danet/core";
import { onRealDeploy } from "@core/business/real-deploy/mod.ts";

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
    const key = address.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
    for (const [k, v] of Object.entries(KNOWN)) if (key.startsWith(k)) return Promise.resolve(v);
    const a = hash(key), b = hash(key + "|lng");
    return Promise.resolve({ lat: 33.60 + a * 0.18, lng: -79.02 + b * 0.16 });
  }
}

export class MapboxGeocoder implements Geocoder {
  constructor(private token: string) {}
  async geocode(address: string): Promise<{ lat: number; lng: number }> {
    const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(address)}&country=us&limit=1&access_token=${this.token}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`mapbox ${r.status}`);
    const j = await r.json();
    const [lng, lat] = j.features?.[0]?.geometry?.coordinates ?? [];
    if (typeof lat !== "number") throw new Error("mapbox: no result for that address");
    return { lat, lng };
  }
}

/** the module's one geocoder — injectable so a test can read the fake's call count */
@Injectable()
export class FieldGeocoder implements Geocoder {
  readonly inner: Geocoder;
  constructor() {
    if (onRealDeploy()) {
      const token = Deno.env.get("MAPBOX_TOKEN");
      if (!token) throw new Error("MAPBOX_TOKEN is required on the real deploy (field geocoding)");
      this.inner = new MapboxGeocoder(token);
    } else this.inner = new FakeGeocoder();
  }
  geocode(address: string) {
    return this.inner.geocode(address);
  }
  get fake(): FakeGeocoder | null {
    return this.inner instanceof FakeGeocoder ? this.inner : null;
  }
}
