/**
 * REQ-856 — the roof tool's outside sources, behind one switch:
 *   locator    — address → point. Mapbox (v6 forward, MAPBOX_TOKEN) when the
 *                token is set, else the US Census geocoder (free, no key;
 *                lands on the street centreline, not the roof).
 *   imagery    — the USGS NAIP Plus image service (public domain, the whole
 *                US, no key): a square Web Mercator window as PNG, and the
 *                catalog item under a point for its date and resolution.
 *   footprints — building outlines OpenStreetMap knows near a point, through
 *                the Overpass API (best effort: a failure is an empty list).
 * `roofSourcesMode`: live on the real deploy (REQ-318) or ROOF_SOURCES=live
 * (what serve.ts sets for a developer run); fake otherwise — the gate, the
 * int tests and a box never leave the machine. The parsers are pure.
 */
import { Injectable } from "#danet/core";
import { decodeBase64 } from "#std/encoding/base64";
import {
  type EnvReader,
  onRealDeploy,
} from "@core/business/real-deploy/mod.ts";
import { type Bbox, bboxAround, type LatLng } from "#roof-geometry/mod.ts";
import { RoofError } from "@roof/dto/roof.ts";

export interface Located {
  lat: number;
  lng: number;
  label: string;
  accuracy: "rooftop" | "street" | "approximate";
  source: string;
}
export interface ImagerySource {
  provider: string;
  name?: string;
  /** flight date, YYYY-MM-DD */
  date?: string;
  /** ground sample distance, cm per pixel */
  gsdCm?: number;
}
export interface RoofLocator {
  locate(q: string): Promise<Located | null>;
}
export interface RoofImagery {
  image(bbox: Bbox, px: number): Promise<Uint8Array>;
  sourceAt(p: LatLng): Promise<ImagerySource>;
}
export interface RoofFootprints {
  near(p: LatLng, radiusM: number): Promise<LatLng[][]>;
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 12_000;

export type RoofSourcesMode = "live" | "fake";
export function roofSourcesMode(env: EnvReader = Deno.env): RoofSourcesMode {
  const explicit = env.get("ROOF_SOURCES")?.trim().toLowerCase();
  if (explicit === "live") return "live";
  if (explicit === "fake") return "fake";
  return onRealDeploy(env) ? "live" : "fake";
}

// ---- parsers (pure) --------------------------------------------------------

// deno-lint-ignore no-explicit-any
export function parseMapbox(json: any): Omit<Located, "source"> | null {
  const f = json?.features?.[0];
  const c = f?.geometry?.coordinates;
  if (
    !Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number"
  ) return null;
  const p = f.properties ?? {};
  const acc = p?.coordinates?.accuracy;
  return {
    lat: c[1],
    lng: c[0],
    label: typeof p.full_address === "string"
      ? p.full_address
      : typeof p.name === "string"
      ? p.name
      : "",
    accuracy: acc === "rooftop" || acc === "parcel"
      ? "rooftop"
      : acc === "street" || acc === "interpolated"
      ? "street"
      : "approximate",
  };
}

// deno-lint-ignore no-explicit-any
export function parseCensus(json: any): Omit<Located, "source"> | null {
  const m = json?.result?.addressMatches?.[0];
  const x = m?.coordinates?.x, y = m?.coordinates?.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  return {
    lat: y,
    lng: x,
    label: typeof m.matchedAddress === "string" ? m.matchedAddress : "",
    accuracy: "street",
  };
}

export const NAIP_SERVICE =
  "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer";

export function naipExportUrl(b: Bbox, px: number): string {
  const u = new URL(`${NAIP_SERVICE}/exportImage`);
  u.searchParams.set("bbox", `${b.west},${b.south},${b.east},${b.north}`);
  u.searchParams.set("bboxSR", "3857");
  u.searchParams.set("imageSR", "3857");
  u.searchParams.set("size", `${px},${px}`);
  u.searchParams.set("format", "png");
  u.searchParams.set("f", "image");
  return u.toString();
}

/** m_<quad>_<quarter>_<utm zone>_<gsd cm>_<yyyymmdd>[.tif] → the flight date and resolution */
export function parseNaipItemName(
  name: string,
): { date: string; gsdCm: number } | null {
  const m = /^m_\d+_[a-z]{2}_\d{1,2}_(\d{3})_(\d{4})(\d{2})(\d{2})(?:\.\w+)?$/i
    .exec(name ?? "");
  if (!m) return null;
  return { date: `${m[2]}-${m[3]}-${m[4]}`, gsdCm: Number(m[1]) };
}

// deno-lint-ignore no-explicit-any
export function parseOverpass(json: any): LatLng[][] {
  const els: unknown[] = Array.isArray(json?.elements) ? json.elements : [];
  const out: LatLng[][] = [];
  for (const e of els as Record<string, unknown>[]) {
    const tags = (e.tags ?? {}) as Record<string, unknown>;
    if (e.type !== "way" || !tags.building || !Array.isArray(e.geometry)) {
      continue;
    }
    const ring = (e.geometry as { lat: number; lon: number }[])
      .filter((g) => typeof g?.lat === "number" && typeof g?.lon === "number")
      .map((g) => ({ lat: g.lat, lng: g.lon }));
    if (ring.length < 4) continue;
    const first = ring[0], last = ring[ring.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) ring.pop();
    if (ring.length >= 3) out.push(ring);
  }
  return out;
}

// ---- live adapters ---------------------------------------------------------

export class MapboxLocator implements RoofLocator {
  constructor(private token: string, private fetchImpl: Fetch = fetch) {}
  async locate(q: string): Promise<Located | null> {
    const u = new URL("https://api.mapbox.com/search/geocode/v6/forward");
    u.searchParams.set("q", q);
    u.searchParams.set("country", "us");
    u.searchParams.set("types", "address");
    u.searchParams.set("limit", "1");
    u.searchParams.set("autocomplete", "false");
    u.searchParams.set("access_token", this.token);
    const r = await this.fetchImpl(u, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      throw new RoofError(`mapbox ${r.status}`, 502, "source_unavailable");
    }
    const p = parseMapbox(await r.json());
    return p ? { ...p, source: "mapbox" } : null;
  }
}

export class CensusLocator implements RoofLocator {
  constructor(private fetchImpl: Fetch = fetch) {}
  async locate(q: string): Promise<Located | null> {
    const u = new URL(
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
    );
    u.searchParams.set("address", q);
    u.searchParams.set("benchmark", "Public_AR_Current");
    u.searchParams.set("format", "json");
    const r = await this.fetchImpl(u, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      throw new RoofError(`census ${r.status}`, 502, "source_unavailable");
    }
    const p = parseCensus(await r.json());
    return p ? { ...p, source: "census" } : null;
  }
}

/** Mapbox first when there is a token; the Census geocoder answers what Mapbox could not (or when there is no token) */
export class ChainLocator implements RoofLocator {
  constructor(private chain: RoofLocator[]) {}
  async locate(q: string): Promise<Located | null> {
    let lastErr: unknown = null;
    for (const l of this.chain) {
      try {
        const p = await l.locate(q);
        if (p) return p;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    return null;
  }
}

export class NaipImagery implements RoofImagery {
  constructor(private fetchImpl: Fetch = fetch) {}
  async image(bbox: Bbox, px: number): Promise<Uint8Array> {
    const r = await this.fetchImpl(naipExportUrl(bbox, px), {
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) {
      await r.body?.cancel();
      throw new RoofError(`naip ${r.status}`, 502, "imagery_unavailable");
    }
    return new Uint8Array(await r.arrayBuffer());
  }
  /** the catalog item under the point; a slow or odd answer from the service
   *  still names the provider (the service is sometimes flaky right after an
   *  export) — one retry, then "USGS NAIP" without a date */
  async sourceAt(p: LatLng): Promise<ImagerySource> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.identify(p);
      } catch (e) {
        console.warn(
          `[roof] naip identify failed (attempt ${attempt + 1}): ${
            (e as Error).message
          }`,
        );
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return { provider: "USGS NAIP" };
  }

  private async identify(p: LatLng): Promise<ImagerySource> {
    const b = bboxAround(p, 1);
    const u = new URL(`${NAIP_SERVICE}/identify`);
    u.searchParams.set(
      "geometry",
      JSON.stringify({ x: (b.west + b.east) / 2, y: (b.south + b.north) / 2 }),
    );
    u.searchParams.set("geometryType", "esriGeometryPoint");
    u.searchParams.set("sr", "3857");
    u.searchParams.set("returnCatalogItems", "true");
    u.searchParams.set("returnGeometry", "false");
    u.searchParams.set("f", "pjson");
    const r = await this.fetchImpl(u, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw new Error(`naip identify ${r.status}`);
    }
    const j = await r.json();
    const items: { attributes?: { Name?: string; Category?: number } }[] =
      j?.catalogItems?.features ?? [];
    for (const it of items) {
      const name = it.attributes?.Name ?? "";
      const parsed = parseNaipItemName(name);
      if (parsed) return { provider: "USGS NAIP", name, ...parsed };
    }
    return { provider: "USGS NAIP" };
  }
}

export class OverpassFootprints implements RoofFootprints {
  constructor(
    private fetchImpl: Fetch = fetch,
    private endpoint = "https://overpass-api.de/api/interpreter",
  ) {}
  async near(p: LatLng, radiusM: number): Promise<LatLng[][]> {
    const q = `[out:json][timeout:8];way(around:${
      Math.round(radiusM)
    },${p.lat},${p.lng})["building"];out geom;`;
    try {
      const r = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) {
        await r.body?.cancel();
        return [];
      }
      return parseOverpass(await r.json());
    } catch {
      return [];
    }
  }
}

// ---- fakes -----------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** any address but one that says "nowhere" lands on a deterministic point around Myrtle Beach */
export class FakeLocator implements RoofLocator {
  locate(q: string): Promise<Located | null> {
    const key = q.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || key.includes("nowhere")) return Promise.resolve(null);
    return Promise.resolve({
      lat: 33.66 + hash(key) * 0.08,
      lng: -79.02 + hash(key + "|lng") * 0.1,
      label: q.trim(),
      accuracy: "rooftop",
      source: "fake",
    });
  }
}

/** a 64 × 64 PNG: a grey block on green — enough to draw on */
const FAKE_PNG = decodeBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAW0lEQVR42u3YMQ0AIAwAwapDA1K6sCEcFZCWXPIGbv2Ye7QuAAAAAAAAAAAAAAAAAAAeATLX1QAAAAAAAAAAAAAAAAAAAAAAagKcOQAAAAAAAAAAAAAAAIBPAAcJ7AIe57w2+AAAAABJRU5ErkJggg==",
);

export class FakeImagery implements RoofImagery {
  image(): Promise<Uint8Array> {
    return Promise.resolve(FAKE_PNG.slice());
  }
  sourceAt(): Promise<ImagerySource> {
    return Promise.resolve({
      provider: "fake",
      name: "m_0000000_nw_17_060_20230410",
      date: "2023-04-10",
      gsdCm: 60,
    });
  }
}

/** one 12 × 18 m rectangle centred on the point */
export class FakeFootprints implements RoofFootprints {
  near(p: LatLng): Promise<LatLng[][]> {
    const dLat = 9 / 111_320;
    const dLng = 6 / (111_320 * Math.cos((p.lat * Math.PI) / 180));
    return Promise.resolve([[
      { lat: p.lat - dLat, lng: p.lng - dLng },
      { lat: p.lat - dLat, lng: p.lng + dLng },
      { lat: p.lat + dLat, lng: p.lng + dLng },
      { lat: p.lat + dLat, lng: p.lng - dLng },
    ]]);
  }
}

// ---- the composition -------------------------------------------------------

export function buildSources(
  env: EnvReader = Deno.env,
  fetchImpl: Fetch = fetch,
): {
  mode: RoofSourcesMode;
  locator: RoofLocator;
  imagery: RoofImagery;
  footprints: RoofFootprints;
} {
  const mode = roofSourcesMode(env);
  if (mode === "fake") {
    return {
      mode,
      locator: new FakeLocator(),
      imagery: new FakeImagery(),
      footprints: new FakeFootprints(),
    };
  }
  const token = env.get("MAPBOX_TOKEN")?.trim();
  const chain: RoofLocator[] = [];
  if (token) chain.push(new MapboxLocator(token, fetchImpl));
  chain.push(new CensusLocator(fetchImpl));
  return {
    mode,
    locator: new ChainLocator(chain),
    imagery: new NaipImagery(fetchImpl),
    footprints: new OverpassFootprints(fetchImpl),
  };
}

@Injectable()
export class RoofSources {
  readonly mode: RoofSourcesMode;
  readonly locator: RoofLocator;
  readonly imagery: RoofImagery;
  readonly footprints: RoofFootprints;
  constructor() {
    const s = buildSources();
    this.mode = s.mode;
    this.locator = s.locator;
    this.imagery = s.imagery;
    this.footprints = s.footprints;
    console.log(`[roof] sources: ${this.mode}`);
  }
}
