/** REQ-288 (demo customers-payments-fieldops-m5) — the assignments map starts on the business, never on the dev seed's town. */
import { assert, assertEquals } from "#std/assert";
import {
  BUSINESS_ZOOM,
  businessAddressLine,
  mapZoomFor,
  STATE_ZOOM,
  US_VIEW,
} from "./mod.ts";
import { FakeGeocoder } from "@field/domain/data/geocoder/mod.ts";

Deno.test("REQ-288 businessAddressLine — the profile address as one geocodable line", () => {
  assertEquals(
    businessAddressLine({
      street: "1600 Congress Ave",
      city: "Austin",
      state: "tx",
      postal: "78701",
    }),
    "1600 Congress Ave, Austin, TX 78701",
  );
  assertEquals(
    businessAddressLine({ city: "Austin", state: "TX" }),
    "Austin, TX",
  );
  assertEquals(businessAddressLine({ postal: "78701" }), "78701");
});

Deno.test("REQ-288 businessAddressLine — nothing to place the business by → null (a street alone names no town)", () => {
  assertEquals(businessAddressLine(null), null);
  assertEquals(businessAddressLine({}), null);
  assertEquals(businessAddressLine({ street: "1 Main St" }), null);
  assertEquals(businessAddressLine({ city: "  ", state: "" }), null);
});

Deno.test("REQ-288 the no-address view is the whole US, not Myrtle Beach", () => {
  assert(US_VIEW.zoom <= 5, `zoomed out to the country: ${US_VIEW.zoom}`);
  assert(
    US_VIEW.lat > 35 && US_VIEW.lat < 42 && US_VIEW.lng > -102 &&
      US_VIEW.lng < -94,
    JSON.stringify(US_VIEW),
  );
  assert(BUSINESS_ZOOM >= 9 && BUSINESS_ZOOM <= 12);
});

Deno.test("REQ-288 FakeGeocoder — an Austin, TX address lands in Austin, not in South Carolina", async () => {
  const g = new FakeGeocoder();
  const p = await g.geocode("1600 Congress Ave, Austin, TX 78701");
  // within ~25 km of Austin (30.27, -97.74)
  assert(
    Math.abs(p.lat - 30.27) < 0.25 && Math.abs(p.lng + 97.74) < 0.25,
    JSON.stringify(p),
  );
  const city = await g.geocode("Austin, TX");
  assert(
    Math.abs(city.lat - 30.27) < 0.25 && Math.abs(city.lng + 97.74) < 0.25,
    JSON.stringify(city),
  );
});

Deno.test("REQ-288 FakeGeocoder — the seeded Myrtle Beach addresses and stateless ones keep their places", async () => {
  const g = new FakeGeocoder();
  assertEquals(await g.geocode("4601 Dick Pond Rd, Myrtle Beach, SC"), {
    lat: 33.6795,
    lng: -79.0035,
  });
  const bare = await g.geocode("1 Main St");
  assert(
    bare.lat > 33.5 && bare.lat < 33.8 && bare.lng > -79.1 && bare.lng < -78.8,
    JSON.stringify(bare),
  );
  // the same address → the same point, every time
  assertEquals(
    await g.geocode("9 Elm St, Denver, CO"),
    await g.geocode("9 Elm St, Denver, CO"),
  );
});

// REQ-747 (demo-loop cycle 5, c4-m50) — onboarding saves only the state ("FL"); the map
// must start on that state, zoomed to the state, not on Myrtle Beach at street zoom.
Deno.test("REQ-747 mapZoomFor — a state alone gets a state-level zoom; anything naming a town keeps the town zoom", () => {
  assert(STATE_ZOOM >= 5 && STATE_ZOOM <= 7, `state-level: ${STATE_ZOOM}`);
  assertEquals(mapZoomFor({ state: "FL" }), STATE_ZOOM);
  assertEquals(
    mapZoomFor({ street: " ", city: "", state: "fl", postal: "" }),
    STATE_ZOOM,
  );
  assertEquals(mapZoomFor({ city: "Miami", state: "FL" }), BUSINESS_ZOOM);
  assertEquals(mapZoomFor({ state: "FL", postal: "33101" }), BUSINESS_ZOOM);
  assertEquals(
    mapZoomFor({ street: "1 Main St", state: "FL" }),
    BUSINESS_ZOOM,
  );
});

Deno.test("REQ-747 FakeGeocoder — a bare state line ('FL', 'FL 33101') lands in that state, not in Myrtle Beach", async () => {
  const g = new FakeGeocoder();
  const inFlorida = (p: { lat: number; lng: number }) =>
    p.lat > 24.4 && p.lat < 31.1 && p.lng > -87.7 && p.lng < -79.9;
  const fl = await g.geocode(businessAddressLine({ state: "FL" })!);
  assert(inFlorida(fl), `FL: ${JSON.stringify(fl)}`);
  const lower = await g.geocode("fl");
  assert(inFlorida(lower), `fl: ${JSON.stringify(lower)}`);
  const zip = await g.geocode(
    businessAddressLine({ state: "FL", postal: "33101" })!,
  );
  assert(inFlorida(zip), `FL 33101: ${JSON.stringify(zip)}`);
  const tx = await g.geocode("TX");
  assert(
    Math.abs(tx.lat - 30.27) < 0.25 && Math.abs(tx.lng + 97.74) < 0.25,
    `TX: ${JSON.stringify(tx)}`,
  );
  // a street that starts with two letters is still not a state
  const bare = await g.geocode("Fl Ave");
  assert(bare.lat > 33.5 && bare.lat < 33.8, JSON.stringify(bare));
});
