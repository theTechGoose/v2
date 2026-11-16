/**
 * REQ-856 — the roof tool's records and its request parsing. A measurement is
 * the account's: the address and point it was taken at, the traced facets
 * (lat/lng rings with a pitch each), the waste % and a note; the summary is
 * computed on read with shared/roof-geometry, never stored.
 */
import {
  FACET_KINDS,
  type FacetKind,
  type LatLng,
  MAX_PITCH,
  MAX_WINDOW_M,
  MIN_WINDOW_M,
  type RoofFacet,
  type RoofSummary,
} from "#roof-geometry/mod.ts";

export type { LatLng, RoofFacet, RoofSummary };

export interface RoofMeasurement {
  id: string;
  userId: string;
  address: string;
  lat: number;
  lng: number;
  facets: RoofFacet[];
  wastePct: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoofMeasurementInput {
  address: string;
  lat: number;
  lng: number;
  facets: RoofFacet[];
  wastePct: number;
  note?: string;
}

/** what the page reads: the record without its owner, plus the summary */
export interface RoofMeasurementView extends Omit<RoofMeasurement, "userId"> {
  summary: RoofSummary;
}

/** REQ-421's shape: a stable `code` the page maps to its own words; `message` for logs */
export class RoofError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RoofError";
  }
}

export const CAP = {
  address: 300,
  note: 2000,
  facets: 40,
  points: 200,
} as const;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() && Number.isFinite(Number(v))
    ? Number(v)
    : undefined;

export function parseLat(v: unknown): number {
  const n = num(v);
  if (n === undefined || n < -90 || n > 90) {
    throw new RoofError("lat must be -90..90");
  }
  return n;
}
export function parseLng(v: unknown): number {
  const n = num(v);
  if (n === undefined || n < -180 || n > 180) {
    throw new RoofError("lng must be -180..180");
  }
  return n;
}
/** the window width in ground metres; unset → 60 */
export function parseWindowM(v: unknown): number {
  if (v === undefined || v === null || v === "") return 60;
  const n = num(v);
  if (n === undefined || n < MIN_WINDOW_M || n > MAX_WINDOW_M) {
    throw new RoofError(`m must be ${MIN_WINDOW_M}..${MAX_WINDOW_M}`);
  }
  return n;
}
/** the image's pixel size; unset → 1000, capped at the service's 4000 */
export function parsePx(v: unknown): number {
  if (v === undefined || v === null || v === "") return 1000;
  const n = num(v);
  if (n === undefined || n < 64 || n > 4000) {
    throw new RoofError("px must be 64..4000");
  }
  return Math.round(n);
}

function parsePoint(v: unknown): LatLng {
  const o = (v ?? {}) as Record<string, unknown>;
  return { lat: parseLat(o.lat), lng: parseLng(o.lng) };
}

export function parseFacet(v: unknown): RoofFacet {
  const o = (v ?? {}) as Record<string, unknown>;
  if (!Array.isArray(o.points) || o.points.length < 3) {
    throw new RoofError(
      "a facet needs at least three points",
      400,
      "facet_too_small",
    );
  }
  if (o.points.length > CAP.points) {
    throw new RoofError(`a facet has at most ${CAP.points} points`);
  }
  const pitch = num(o.pitch ?? 0);
  if (pitch === undefined || pitch < 0 || pitch > MAX_PITCH) {
    throw new RoofError(
      `pitch must be 0..${MAX_PITCH} (rise per 12)`,
      400,
      "bad_pitch",
    );
  }
  // REQ-891 — the kind: a roof (default, and every section saved before) or a
  // flat surface such as a driveway, whose pitch is always 0
  const kind = o.kind === undefined ? "roof" : o.kind;
  if (!(FACET_KINDS as readonly unknown[]).includes(kind)) {
    throw new RoofError(
      `kind must be one of ${FACET_KINDS.join(", ")}`,
      400,
      "bad_kind",
    );
  }
  const k = kind as FacetKind;
  return {
    points: o.points.map(parsePoint),
    pitch: k === "flat" ? 0 : pitch,
    kind: k,
  };
}

export function parseMeasurementInput(raw: unknown): RoofMeasurementInput {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const address = typeof b.address === "string" ? b.address.trim() : "";
  if (!address) {
    throw new RoofError("address is required", 400, "address_required");
  }
  if (address.length > CAP.address) {
    throw new RoofError(`address too long (max ${CAP.address})`);
  }
  if (!Array.isArray(b.facets) || !b.facets.length) {
    throw new RoofError("trace at least one facet", 400, "no_facets");
  }
  if (b.facets.length > CAP.facets) {
    throw new RoofError(`at most ${CAP.facets} facets`);
  }
  const wastePct = num(b.wastePct ?? 0);
  if (wastePct === undefined || wastePct < 0 || wastePct > 100) {
    throw new RoofError("wastePct must be 0..100", 400, "bad_waste");
  }
  const note = typeof b.note === "string" && b.note.trim()
    ? b.note.trim()
    : undefined;
  if (note && note.length > CAP.note) {
    throw new RoofError(`note too long (max ${CAP.note})`);
  }
  return {
    address,
    lat: parseLat(b.lat),
    lng: parseLng(b.lng),
    facets: b.facets.map(parseFacet),
    wastePct,
    note,
  };
}
