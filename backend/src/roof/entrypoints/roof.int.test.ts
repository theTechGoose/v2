/**
 * REQ-856 — the roof tool over HTTP, in process on an in-memory KV, on the
 * FAKE sources (no ROOF_SOURCES → fake: nothing leaves the box): the owner's
 * session locates an address, reads the site window and its image, and keeps
 * account-owned measurements whose summary the server computes.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { RoofModule } from "@roof/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [RoofModule] })
class TestApp {}
const PORT = 9163;
const J = { "content-type": "application/json" };

// deno-lint-ignore no-explicit-any
type Res = { status: number; body: any; headers: Headers; bytes: Uint8Array };
async function withServer(
  fn: (
    call: (
      method: string,
      path: string,
      body?: unknown,
      headers?: HeadersInit,
    ) => Promise<Res>,
  ) => Promise<void>,
) {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("ROOF_SOURCES");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: HeadersInit = {},
  ) => {
    const r = await fetch(`http://localhost:${PORT}${path}`, {
      method,
      headers: { ...J, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const bytes = new Uint8Array(await r.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch { /* raw */ }
    return { status: r.status, body: parsed, headers: r.headers, bytes };
  };
  try {
    await fn(call);
  } finally {
    await server.stop();
    await resetKv();
  }
}
type Call = Parameters<Parameters<typeof withServer>[0]>[0];

async function login(call: Call, phone = "+15125551600", name = "Roof Owner") {
  await call("POST", "/auth/send-otp", { phoneNumber: phone });
  const stored = await new OtpStore().get(phone);
  const v = await call("POST", "/auth/verify-otp", {
    phoneNumber: phone,
    code: stored!.code,
  });
  const H = { "x-session-id": v.body.sessionId as string };
  await call("PUT", "/me", { name, language: "en" }, H);
  return H;
}

const ADDRESS = "4505 Socastee Blvd, Myrtle Beach, SC 29588";
/** a ~10 × 20 m rectangle near the fake's point */
const facet = (lat: number, lng: number, pitch = 6) => ({
  pitch,
  points: [
    { lat, lng },
    { lat, lng: lng + 0.000108 },
    { lat: lat + 0.00018, lng: lng + 0.000108 },
    { lat: lat + 0.00018, lng },
  ],
});

Deno.test("REQ-856 locate — the owner's session turns an address into a point; an unknown address is 404 address_not_found; no session is 401", async () => {
  await withServer(async (call) => {
    const H = await login(call);
    const r = await call(
      "GET",
      `/roof/locate?q=${encodeURIComponent(ADDRESS)}`,
      undefined,
      H,
    );
    assertEquals(r.status, 200);
    assert(typeof r.body.lat === "number" && typeof r.body.lng === "number");
    assertEquals(r.body.source, "fake");
    assert(typeof r.body.label === "string" && r.body.label.length > 0);

    const miss = await call(
      "GET",
      "/roof/locate?q=nowhere%20at%20all",
      undefined,
      H,
    );
    assertEquals(miss.status, 404);
    assertEquals(miss.body.code, "address_not_found");

    const short = await call("GET", "/roof/locate?q=ab", undefined, H);
    assertEquals(short.status, 400);

    const anon = await call(
      "GET",
      `/roof/locate?q=${encodeURIComponent(ADDRESS)}`,
    );
    assertEquals(anon.status, 401);
  });
});

Deno.test("REQ-856 site + image — the window around a point: its Web Mercator box, pixel size, the imagery's provider/date/resolution, the building outlines near it; the image is a PNG", async () => {
  await withServer(async (call) => {
    const H = await login(call);
    const site = await call(
      "GET",
      "/roof/site?lat=33.6860&lng=-78.9803&m=60",
      undefined,
      H,
    );
    assertEquals(site.status, 200);
    const b = site.body;
    assert(b.bbox.west < b.bbox.east && b.bbox.south < b.bbox.north);
    assertEquals(b.meters, 60);
    assertEquals(b.source.provider, "fake");
    assert(
      Array.isArray(b.footprints) && b.footprints.length >= 1,
      "the fake answers one outline",
    );
    assert(b.footprints[0].length >= 3);

    const bad = await call("GET", "/roof/site?lat=999&lng=0", undefined, H);
    assertEquals(bad.status, 400);
    const tooWide = await call(
      "GET",
      "/roof/site?lat=33.6&lng=-78.9&m=5000",
      undefined,
      H,
    );
    assertEquals(tooWide.status, 400);

    const img = await call(
      "GET",
      "/roof/image?lat=33.6860&lng=-78.9803&m=60&px=256",
      undefined,
      H,
    );
    assertEquals(img.status, 200);
    assertEquals(img.headers.get("content-type"), "image/png");
    assertEquals(Array.from(img.bytes.slice(0, 4)), [0x89, 0x50, 0x4e, 0x47]);

    const anon = await call("GET", "/roof/image?lat=33.6860&lng=-78.9803");
    assertEquals(anon.status, 401);
  });
});

Deno.test("REQ-856 measurements — created with its summary, listed newest first, read/updated/deleted by its owner only; a bad facet or pitch is 400", async () => {
  await withServer(async (call) => {
    const H = await login(call);
    const lat = 33.6860, lng = -78.9803;
    const c = await call("POST", "/roof/measurements", {
      address: ADDRESS,
      lat,
      lng,
      facets: [facet(lat, lng, 6)],
      wastePct: 10,
    }, H);
    assertEquals(c.status, 201, JSON.stringify(c.body));
    const m = c.body;
    assert(typeof m.id === "string");
    assertEquals(m.address, ADDRESS);
    assertEquals(m.facets.length, 1);
    assertEquals(m.wastePct, 10);
    assert(
      m.summary.planSqft > 2000 && m.summary.planSqft < 2300,
      `plan ${m.summary.planSqft}`,
    );
    assert(m.summary.surfaceSqft > m.summary.planSqft, "6/12 adds surface");
    assert(
      m.summary.withWasteSqft > m.summary.surfaceSqft,
      "waste adds on top",
    );
    assertEquals(m.summary.squares, Math.round(m.summary.withWasteSqft) / 100);
    assertEquals("userId" in m, false, "the view never leaks the owner id");

    // validation
    for (
      const bad of [
        { address: ADDRESS, lat, lng, facets: [], wastePct: 10 },
        {
          address: ADDRESS,
          lat,
          lng,
          facets: [{ pitch: 6, points: facet(lat, lng).points.slice(0, 2) }],
          wastePct: 10,
        },
        {
          address: ADDRESS,
          lat,
          lng,
          facets: [facet(lat, lng, 99)],
          wastePct: 10,
        },
        {
          address: ADDRESS,
          lat,
          lng,
          facets: [facet(lat, lng)],
          wastePct: 150,
        },
        { address: "", lat, lng, facets: [facet(lat, lng)], wastePct: 10 },
        {
          address: ADDRESS,
          lat: 200,
          lng,
          facets: [facet(lat, lng)],
          wastePct: 10,
        },
      ]
    ) {
      const r = await call("POST", "/roof/measurements", bad, H);
      assertEquals(r.status, 400, JSON.stringify(bad));
    }

    // a second one, then the list is newest first
    const c2 = await call("POST", "/roof/measurements", {
      address: "1 Elm St, Austin, TX 78701",
      lat: 30.27,
      lng: -97.74,
      facets: [facet(30.27, -97.74, 0)],
      wastePct: 0,
    }, H);
    assertEquals(c2.status, 201);
    const list = await call("GET", "/roof/measurements", undefined, H);
    assertEquals(list.status, 200);
    assertEquals(list.body.map((x: { id: string }) => x.id), [
      c2.body.id,
      m.id,
    ]);

    // read / update
    const one = await call("GET", `/roof/measurements/${m.id}`, undefined, H);
    assertEquals(one.status, 200);
    assertEquals(one.body.id, m.id);
    const up = await call("PUT", `/roof/measurements/${m.id}`, {
      address: ADDRESS,
      lat,
      lng,
      facets: [facet(lat, lng, 0)],
      wastePct: 15,
      note: "garage not included",
    }, H);
    assertEquals(up.status, 200);
    assertEquals(up.body.wastePct, 15);
    assertEquals(up.body.note, "garage not included");
    assertEquals(
      Math.round(up.body.summary.surfaceSqft),
      Math.round(up.body.summary.planSqft),
      "flat now",
    );

    // another account: 403 on read/update/delete, and its own list is empty
    const H2 = await login(call, "+15125551601", "Other Owner");
    assertEquals(
      (await call("GET", `/roof/measurements/${m.id}`, undefined, H2)).status,
      403,
    );
    assertEquals(
      (await call("DELETE", `/roof/measurements/${m.id}`, undefined, H2))
        .status,
      403,
    );
    assertEquals(
      (await call("GET", "/roof/measurements", undefined, H2)).body,
      [],
    );
    assertEquals(
      (await call("GET", "/roof/measurements/nope", undefined, H)).status,
      404,
    );

    // delete
    const del = await call(
      "DELETE",
      `/roof/measurements/${m.id}`,
      undefined,
      H,
    );
    assertEquals(del.status, 200);
    assertEquals(
      (await call("GET", `/roof/measurements/${m.id}`, undefined, H)).status,
      404,
    );
    assertEquals(
      (await call("GET", "/roof/measurements", undefined, H)).body.length,
      1,
    );
  });
});
