/**
 * REQ-856 — the roof tool's outside sources, parsed pure: a Mapbox v6 or
 * Census geocoder answer → one point; a USGS NAIP export URL; the vintage
 * and ground resolution read off a NAIP catalog item's name; Overpass
 * building ways → lat/lng rings; and the live-vs-fake switch.
 */
import { assert, assertEquals } from "#std/assert";
import {
  naipExportUrl,
  parseCensus,
  parseMapbox,
  parseNaipItemName,
  parseOverpass,
  roofSourcesMode,
} from "./mod.ts";

Deno.test("REQ-856 parseMapbox: the first feature's rooftop point and full address; no features → null", () => {
  const r = parseMapbox({
    features: [{
      geometry: { type: "Point", coordinates: [-78.9803, 33.6861] },
      properties: {
        full_address:
          "4505 Socastee Blvd, Myrtle Beach, South Carolina 29588, United States",
        coordinates: {
          longitude: -78.9803,
          latitude: 33.6861,
          accuracy: "rooftop",
        },
      },
    }],
  });
  assertEquals(r, {
    lat: 33.6861,
    lng: -78.9803,
    label:
      "4505 Socastee Blvd, Myrtle Beach, South Carolina 29588, United States",
    accuracy: "rooftop",
  });
  assertEquals(parseMapbox({ features: [] }), null);
  assertEquals(parseMapbox(null), null);
});

Deno.test("REQ-856 parseCensus: the first match's coordinates (x = lng, y = lat); no match → null", () => {
  const r = parseCensus({
    result: {
      addressMatches: [{
        matchedAddress: "4505 SOCASTEE BLVD, MYRTLE BEACH, SC, 29588",
        coordinates: { x: -78.98076868462, y: 33.685961459404 },
      }],
    },
  });
  assertEquals(r?.lat, 33.685961459404);
  assertEquals(r?.lng, -78.98076868462);
  assertEquals(r?.label, "4505 SOCASTEE BLVD, MYRTLE BEACH, SC, 29588");
  assertEquals(r?.accuracy, "street");
  assertEquals(parseCensus({ result: { addressMatches: [] } }), null);
});

Deno.test("REQ-856 naipExportUrl: the USGS NAIP Plus exportImage call — the Web Mercator window, a square PNG", () => {
  const u = new URL(
    naipExportUrl({
      west: -8792971,
      south: 3986349,
      east: -8792881,
      north: 3986439,
    }, 800),
  );
  assertEquals(
    u.origin + u.pathname,
    "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage",
  );
  assertEquals(u.searchParams.get("bbox"), "-8792971,3986349,-8792881,3986439");
  assertEquals(u.searchParams.get("bboxSR"), "3857");
  assertEquals(u.searchParams.get("imageSR"), "3857");
  assertEquals(u.searchParams.get("size"), "800,800");
  assertEquals(u.searchParams.get("format"), "png");
  assertEquals(u.searchParams.get("f"), "image");
});

Deno.test("REQ-856 parseNaipItemName: m_<quad>_<quarter>_<zone>_<gsd cm>_<yyyymmdd> → the flight date and ground resolution; anything else → null", () => {
  assertEquals(parseNaipItemName("m_3307817_nw_17_060_20230410"), {
    date: "2023-04-10",
    gsdCm: 60,
  });
  assertEquals(parseNaipItemName("m_3307817_sw_17_030_20250601.tif"), {
    date: "2025-06-01",
    gsdCm: 30,
  });
  assertEquals(parseNaipItemName("Ov_i02_L01_R0000015E_C00000072.tif"), null);
  assertEquals(parseNaipItemName(""), null);
});

Deno.test("REQ-856 parseOverpass: each building way's geometry becomes a ring without the repeated closing point; non-buildings and open ways are skipped", () => {
  const rings = parseOverpass({
    elements: [
      {
        type: "way",
        id: 1,
        tags: { building: "yes" },
        geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }, {
          lat: 2,
          lon: 1,
        }, { lat: 1, lon: 1 }],
      },
      {
        type: "way",
        id: 2,
        tags: { highway: "residential" },
        geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }],
      },
      {
        type: "way",
        id: 3,
        tags: { building: "house" },
        geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }],
      },
    ],
  });
  assertEquals(rings, [[{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, {
    lat: 2,
    lng: 2,
  }, { lat: 2, lng: 1 }]]);
  assertEquals(parseOverpass(null), []);
});

Deno.test("REQ-856 roofSourcesMode: live on the real deploy or ROOF_SOURCES=live; fake otherwise (the gate, the int tests, a box)", () => {
  const env = (o: Record<string, string>) => ({ get: (k: string) => o[k] });
  assertEquals(roofSourcesMode(env({})), "fake");
  assertEquals(roofSourcesMode(env({ ROOF_SOURCES: "fake" })), "fake");
  assertEquals(roofSourcesMode(env({ ROOF_SOURCES: "live" })), "live");
  assertEquals(roofSourcesMode(env({ DENO_DEPLOY: "true" })), "live");
  assertEquals(
    roofSourcesMode(env({ DENO_DEPLOYMENT_ID: "abc", ROOF_SOURCES: "fake" })),
    "fake",
    "an explicit fake wins even on the real deploy — a prod story never leaves the box",
  );
  assert(true);
});
