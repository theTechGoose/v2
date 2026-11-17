/** REQ-288 (demo customers-payments-fieldops-m5) — the assignments map's starting view. */
import { assert, assertEquals } from "@std/assert";
import { assignmentsMapView, US_MAP_VIEW } from "./field.ts";

const austin = { lat: 30.27, lng: -97.74, zoom: 11 };

Deno.test("REQ-288 assignmentsMapView — subscriptions on the map → fit them", () => {
  const pts: [number, number][] = [[30.3, -97.7], [30.2, -97.8]];
  assertEquals(assignmentsMapView(pts, austin), { fit: pts });
  assertEquals(assignmentsMapView(pts, null), { fit: pts });
});

Deno.test("REQ-288 assignmentsMapView — no subscriptions → the business's own place", () => {
  assertEquals(assignmentsMapView([], austin), {
    center: [30.27, -97.74],
    zoom: 11,
  });
});

Deno.test("REQ-288 assignmentsMapView — no subscriptions, no business place → the whole US, never Myrtle Beach", () => {
  const v = assignmentsMapView([], null);
  assertEquals(v, {
    center: [US_MAP_VIEW.lat, US_MAP_VIEW.lng],
    zoom: US_MAP_VIEW.zoom,
  });
  assert(!("fit" in v) && Math.abs(v.center[0] - 33.69) > 1);
  assert(v.zoom <= 5);
});

Deno.test("REQ-288 FieldAssignmentsPage — no hard-coded seed-town centre left in the island", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/FieldAssignmentsPage.tsx", import.meta.url),
  );
  assert(
    !/33\.69/.test(src) && !/-78\.93/.test(src),
    "Myrtle Beach literal still present",
  );
  assert(
    /assignmentsMapView\(/.test(src),
    "the island uses assignmentsMapView",
  );
  assert(
    /mapCenter\(/.test(src),
    "the island asks the server for the business centre",
  );
});
