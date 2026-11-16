/**
 * REQ-856 — roof measurement geometry, pure and isomorphic: the page draws and
 * measures with it, the API computes the saved summary with the same code.
 *
 * A facet is a ring of lat/lng points the owner traced on the aerial image.
 * Its PLAN area is the shoelace area in a local equirectangular frame (exact
 * to well under 0.1% at roof scale); the SURFACE area multiplies by the pitch
 * factor sqrt(1 + (rise/12)^2); waste is a percentage on top; a roofing
 * square is 100 sqft. The imagery window is a square in Web Mercator (what
 * the USGS image service exports) whose width is TRUE ground metres.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** a Web Mercator (EPSG:3857) box, metres */
export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface RoofFacet {
  points: LatLng[];
  /** rise per 12 of run, 0 (flat) … 24 */
  pitch: number;
}

export interface FacetSummary {
  pitch: number;
  planSqft: number;
  surfaceSqft: number;
  perimeterFt: number;
}

export interface RoofSummary {
  facets: FacetSummary[];
  planSqft: number;
  surfaceSqft: number;
  wastePct: number;
  withWasteSqft: number;
  /** roofing squares (100 sqft) of the with-waste area, to 2 decimals */
  squares: number;
  perimeterFt: number;
}

export const M2_TO_SQFT = 10.763910417;
export const M_TO_FT = 3.280839895;
const EARTH_R = 6378137;
const M_PER_DEG_LAT = 111_320;
const rad = (d: number) => (d * Math.PI) / 180;

export const MAX_PITCH = 24;
export const MIN_WINDOW_M = 20;
export const MAX_WINDOW_M = 300;

// ---- Web Mercator ----------------------------------------------------------

export function toMercator(p: LatLng): { x: number; y: number } {
  const lat = Math.max(-85.05, Math.min(85.05, p.lat));
  return {
    x: EARTH_R * rad(p.lng),
    y: EARTH_R * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2)),
  };
}

export function fromMercator(x: number, y: number): LatLng {
  return {
    lng: (x / EARTH_R) * (180 / Math.PI),
    lat: (2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2) * (180 / Math.PI),
  };
}

/** a square window `meters` TRUE ground metres wide, centred on `center` */
export function bboxAround(center: LatLng, meters: number): Bbox {
  const c = toMercator(center);
  // Mercator stretches by 1/cos(lat): a true-metre half-width is larger on the map
  const half = meters / 2 / Math.cos(rad(center.lat));
  return {
    west: c.x - half,
    south: c.y - half,
    east: c.x + half,
    north: c.y + half,
  };
}

/** canvas pixel (origin top-left, y down) → lat/lng, for a `size` px square image of `bbox` */
export function pixelToLatLng(
  px: number,
  py: number,
  bbox: Bbox,
  size: number,
): LatLng {
  const x = bbox.west + (px / size) * (bbox.east - bbox.west);
  const y = bbox.north - (py / size) * (bbox.north - bbox.south);
  return fromMercator(x, y);
}

export function latLngToPixel(
  p: LatLng,
  bbox: Bbox,
  size: number,
): { x: number; y: number } {
  const m = toMercator(p);
  return {
    x: ((m.x - bbox.west) / (bbox.east - bbox.west)) * size,
    y: ((bbox.north - m.y) / (bbox.north - bbox.south)) * size,
  };
}

// ---- local metres ----------------------------------------------------------

/** the points in a local equirectangular frame (metres east/north of `origin`) */
export function localXY(
  points: LatLng[],
  origin: LatLng,
): { x: number; y: number }[] {
  const k = M_PER_DEG_LAT * Math.cos(rad(origin.lat));
  return points.map((p) => ({
    x: (p.lng - origin.lng) * k,
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  }));
}

export function planAreaM2(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const xy = localXY(points, points[0]);
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i], b = xy[(i + 1) % xy.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function perimeterM(points: LatLng[]): number {
  if (points.length < 2) return 0;
  const xy = localXY(points, points[0]);
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i], b = xy[(i + 1) % xy.length];
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}

/** sqrt(1 + (rise/12)^2); the rise clamps to 0 … MAX_PITCH */
export function pitchFactor(rise: number): number {
  const r = Math.max(0, Math.min(MAX_PITCH, Number.isFinite(rise) ? rise : 0));
  return Math.sqrt(1 + (r / 12) ** 2);
}

export function facetSummary(f: RoofFacet): FacetSummary {
  const planSqft = planAreaM2(f.points) * M2_TO_SQFT;
  return {
    pitch: f.pitch,
    planSqft,
    surfaceSqft: planSqft * pitchFactor(f.pitch),
    perimeterFt: perimeterM(f.points) * M_TO_FT,
  };
}

export function summarize(facets: RoofFacet[], wastePct: number): RoofSummary {
  const rows = facets.map(facetSummary);
  const planSqft = rows.reduce((s, r) => s + r.planSqft, 0);
  const surfaceSqft = rows.reduce((s, r) => s + r.surfaceSqft, 0);
  const waste = Math.max(
    0,
    Math.min(100, Number.isFinite(wastePct) ? wastePct : 0),
  );
  const withWasteSqft = surfaceSqft * (1 + waste / 100);
  return {
    facets: rows,
    planSqft,
    surfaceSqft,
    wastePct: waste,
    withWasteSqft,
    squares: Math.round(withWasteSqft) / 100,
    perimeterFt: rows.reduce((s, r) => s + r.perimeterFt, 0),
  };
}

/** the ring's centroid (plain average of its points) — where a seeded facet "is" */
export function centroid(points: LatLng[]): LatLng {
  const n = points.length || 1;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
  };
}

/** ground metres between two points (equirectangular — fine at window scale) */
export function distanceM(a: LatLng, b: LatLng): number {
  const [p] = localXY([b], a);
  return Math.hypot(p.x, p.y);
}
