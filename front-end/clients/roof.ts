/**
 * REQ-856 — the roof tool's API client (/api/roof/*). Types mirror the
 * backend's views; the geometry types come from shared/roof-geometry.
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type {
  Bbox,
  LatLng,
  RoofFacet,
  RoofSummary,
} from "../../shared/roof-geometry/mod.ts";

export type { Bbox, LatLng, RoofFacet, RoofSummary };

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
  date?: string;
  gsdCm?: number;
}

export interface SiteInfo {
  center: LatLng;
  meters: number;
  bbox: Bbox;
  source: ImagerySource;
  footprints: LatLng[][];
}

export interface RoofMeasurementInput {
  address: string;
  lat: number;
  lng: number;
  facets: RoofFacet[];
  wastePct: number;
  note?: string;
}

export interface RoofMeasurementView extends RoofMeasurementInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  summary: RoofSummary;
}

const q = (o: Record<string, string | number>) =>
  "?" +
  Object.entries(o).map(([k, v]) =>
    `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
  ).join("&");

export const roofClient = {
  locate: (query: string, opts?: ApiOptions) =>
    api.get<Located>(`/roof/locate${q({ q: query })}`, opts),
  site: (center: LatLng, meters: number, opts?: ApiOptions) =>
    api.get<SiteInfo>(
      `/roof/site${q({ lat: center.lat, lng: center.lng, m: meters })}`,
      opts,
    ),
  /** the aerial window's image, as a same-origin URL an <img> can load (the session cookie rides along) */
  imageUrl: (center: LatLng, meters: number, px: number) =>
    `/api/roof/image${q({ lat: center.lat, lng: center.lng, m: meters, px })}`,
  measurements: (opts?: ApiOptions) =>
    api.get<RoofMeasurementView[]>("/roof/measurements", opts),
  create: (b: RoofMeasurementInput, opts?: ApiOptions) =>
    api.post<RoofMeasurementView>("/roof/measurements", b, opts),
  update: (id: string, b: RoofMeasurementInput, opts?: ApiOptions) =>
    api.put<RoofMeasurementView>(
      `/roof/measurements/${encodeURIComponent(id)}`,
      b,
      opts,
    ),
  remove: (id: string, opts?: ApiOptions) =>
    api.delete<{ ok: true }>(
      `/roof/measurements/${encodeURIComponent(id)}`,
      opts,
    ),
};
