/**
 * REQ-856 — roof measurement geometry (shared/roof-geometry): the pure math
 * the page and the API both use. A traced facet is lat/lng points; its plan
 * area is the shoelace area in local metres, the surface area scales by the
 * pitch factor sqrt(1 + (rise/12)^2), waste is a percentage on top, and a
 * roofing square is 100 sqft. The imagery window is a square in Web Mercator
 * whose width is TRUE ground metres, and a canvas pixel maps to a lat/lng
 * through that window.
 */
import {
  bboxAround,
  fromMercator,
  latLngToPixel,
  M2_TO_SQFT,
  perimeterM,
  pitchFactor,
  pixelToLatLng,
  planAreaM2,
  summarize,
} from "../../shared/roof-geometry/mod";

const LAT = 33.7, LNG = -78.98;
/** metres → degrees at LAT (equirectangular) */
const dLat = (m: number) => m / 111_320;
const dLng = (m: number) => m / (111_320 * Math.cos((LAT * Math.PI) / 180));
/** a w × h metre rectangle with its SW corner at (LAT, LNG) */
const rect = (w: number, h: number) => [
  { lat: LAT, lng: LNG },
  { lat: LAT, lng: LNG + dLng(w) },
  { lat: LAT + dLat(h), lng: LNG + dLng(w) },
  { lat: LAT + dLat(h), lng: LNG },
];

describe("REQ-856 roof geometry", () => {
  test("planAreaM2: a 10 × 20 m rectangle is 200 m² (within 0.1%)", () => {
    expect(Math.abs(planAreaM2(rect(10, 20)) - 200)).toBeLessThan(0.2);
  });
  test("planAreaM2: fewer than three points is 0, and point order does not matter", () => {
    expect(planAreaM2([])).toBe(0);
    expect(planAreaM2(rect(10, 20).slice(0, 2))).toBe(0);
    expect(Math.abs(planAreaM2([...rect(10, 20)].reverse()) - 200))
      .toBeLessThan(0.2);
  });
  test("perimeterM closes the ring: a 10 × 20 m rectangle is 60 m", () => {
    expect(Math.abs(perimeterM(rect(10, 20)) - 60)).toBeLessThan(0.06);
  });
  test("pitchFactor: flat is 1, 12/12 is √2, 6/12 is 1.118; out-of-range rises clamp to 0..24", () => {
    expect(pitchFactor(0)).toBe(1);
    expect(pitchFactor(12)).toBeCloseTo(Math.SQRT2, 6);
    expect(pitchFactor(6)).toBeCloseTo(1.118, 3);
    expect(pitchFactor(-3)).toBe(1);
    expect(pitchFactor(99)).toBe(pitchFactor(24));
  });
  test("summarize: one 200 m² facet at 6/12 with 10% waste → 2153 plan sqft, 2407 surface, 2648 with waste, 26.48 squares", () => {
    const s = summarize([{ points: rect(10, 20), pitch: 6 }], 10);
    expect(s.facets).toHaveLength(1);
    expect(Math.round(s.planSqft)).toBe(Math.round(200 * M2_TO_SQFT));
    expect(Math.round(s.surfaceSqft)).toBe(2407);
    expect(Math.round(s.withWasteSqft)).toBe(2648);
    expect(s.squares).toBeCloseTo(26.48, 1);
    expect(s.wastePct).toBe(10);
  });
  test("summarize: facets add up, a facet's own pitch applies to it alone", () => {
    const s = summarize(
      [{ points: rect(10, 20), pitch: 0 }, { points: rect(10, 10), pitch: 12 }],
      0,
    );
    expect(Math.round(s.planSqft)).toBe(Math.round(300 * M2_TO_SQFT));
    expect(Math.round(s.surfaceSqft)).toBe(
      Math.round((200 + 100 * Math.SQRT2) * M2_TO_SQFT),
    );
    expect(s.facets[1].surfaceSqft).toBeCloseTo(
      100 * Math.SQRT2 * M2_TO_SQFT,
      0,
    );
  });
  test("bboxAround: a 60 m window is 60 TRUE ground metres wide (within 0.5%) and centred", () => {
    const b = bboxAround({ lat: LAT, lng: LNG }, 60);
    const sw = fromMercator(b.west, b.south),
      ne = fromMercator(b.east, b.north);
    const widthM = (ne.lng - sw.lng) * 111_320 *
      Math.cos((LAT * Math.PI) / 180);
    expect(Math.abs(widthM - 60)).toBeLessThan(0.3);
    const c = fromMercator((b.west + b.east) / 2, (b.south + b.north) / 2);
    expect(c.lat).toBeCloseTo(LAT, 6);
    expect(c.lng).toBeCloseTo(LNG, 6);
  });
  test("pixel ↔ lat/lng: the centre pixel is the window centre, y grows southward, and the round trip is exact to a millimetre", () => {
    const b = bboxAround({ lat: LAT, lng: LNG }, 60);
    const c = pixelToLatLng(500, 500, b, 1000);
    expect(c.lat).toBeCloseTo(LAT, 6);
    expect(c.lng).toBeCloseTo(LNG, 6);
    const south = pixelToLatLng(500, 900, b, 1000);
    expect(south.lat).toBeLessThan(LAT);
    const px = latLngToPixel(pixelToLatLng(123, 456, b, 1000), b, 1000);
    expect(px.x).toBeCloseTo(123, 3);
    expect(px.y).toBeCloseTo(456, 3);
  });
});
