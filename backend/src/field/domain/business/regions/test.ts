/** REQ-140 — subscriptions group into zones by distance; the owner's drag is honoured. */
import { assert, assertEquals, assertNotEquals } from "#std/assert";
import { distanceKm, groupRegions } from "./mod.ts";
import type { Region, Subscription } from "@field/dto/field.ts";

let n = 0;
const newId = () => `r${++n}`;
const sub = (id: string, lat: number, lng: number, extra: Partial<Subscription> = {}): Subscription => ({
  id, userId: "u", customerId: "c", address: id, lat, lng, items: [], cadence: "weekly", active: true, createdAt: "2026-10-27", updatedAt: "2026-10-27", ...extra,
});
const region = (id: string, workerId?: string): Region => ({ id, userId: "u", name: id, color: "#000", lat: 0, lng: 0, workerId });

// Socastee (west of the waterway) vs Ocean Blvd (east) — ~12 km apart
const WEST_A = sub("wa", 33.6835, -79.0074), WEST_B = sub("wb", 33.6795, -79.0035);
const EAST_A = sub("ea", 33.6945, -78.8780), EAST_B = sub("eb", 33.6900, -78.8900);

Deno.test("REQ-140 groupRegions — nearby subscriptions group into one zone, far ones into another", () => {
  const { regions, assignments } = groupRegions([WEST_A, WEST_B, EAST_A, EAST_B], [], { newId, userId: "u" });
  assertEquals(regions.length, 2);
  assertEquals(assignments.get("wa"), assignments.get("wb"));
  assertEquals(assignments.get("ea"), assignments.get("eb"));
  assertNotEquals(assignments.get("wa"), assignments.get("ea"));
  assert(regions.every((r) => r.userId === "u"));
});

Deno.test("REQ-140 groupRegions — pure: it only reads stored coordinates", () => {
  const { regions } = groupRegions([WEST_A], [], { newId, userId: "u" });
  assertEquals(regions.length, 1);
  assert(distanceKm(regions[0], WEST_A) < 0.01);
});

Deno.test("REQ-140 groupRegions — a new subscription joins the nearest zone or starts one; zones keep id and worker", () => {
  const first = groupRegions([WEST_A, EAST_A], [], { newId, userId: "u" });
  const staffed: Region[] = first.regions.map((r) => ({ ...r, workerId: "w1" }));
  const near = sub("wc", 33.6880, -79.0010);
  const second = groupRegions([WEST_A, EAST_A, near], staffed, { newId, userId: "u" });
  assertEquals(second.assignments.get("wc"), first.assignments.get("wa"));
  assertEquals(second.regions.map((r) => r.id).sort(), staffed.map((r) => r.id).sort());
  assert(second.regions.every((r) => r.workerId === "w1"));
  const far = sub("sf", 33.6060, -78.9730); // Surfside, ~9 km south
  const third = groupRegions([WEST_A, EAST_A, near, far], second.regions, { newId, userId: "u" });
  assertEquals(third.regions.length, 3);
  assert(!staffed.some((r) => r.id === third.assignments.get("sf")));
});

Deno.test("REQ-140 groupRegions — a pinned subscription stays where the owner put it through a re-run", () => {
  const first = groupRegions([WEST_A, WEST_B, EAST_A], [], { newId, userId: "u" });
  const westId = first.assignments.get("wa")!, eastId = first.assignments.get("ea")!;
  const moved = sub("wb", WEST_B.lat, WEST_B.lng, { regionId: eastId, pinned: true });
  const again = groupRegions([WEST_A, moved, EAST_A, sub("wd", 33.6900, -79.0000)], first.regions, { newId, userId: "u" });
  assertEquals(again.assignments.get("wb"), eastId, "pinned sub not snapped back");
  assertEquals(again.assignments.get("wd"), westId, "unpinned new sub still groups by distance");
});

Deno.test("REQ-140 groupRegions — an empty zone with a worker survives; an empty one without is dropped", () => {
  const { regions } = groupRegions([], [region("keep", "w1"), region("drop")], { newId, userId: "u" });
  assertEquals(regions.map((x) => x.id), ["keep"]);
});

Deno.test("REQ-140 groupRegions — a far subscription dragged in never ejects the zone's own members or moves its centre", () => {
  const first = groupRegions([WEST_A, WEST_B, EAST_A], [], { newId, userId: "u" });
  const westId = first.assignments.get("wa")!;
  const moved = sub("ea", EAST_A.lat, EAST_A.lng, { regionId: westId, pinned: true });
  const again = groupRegions([WEST_A, WEST_B, moved], first.regions, { newId, userId: "u" });
  assertEquals([again.assignments.get("wa"), again.assignments.get("wb"), again.assignments.get("ea")], [westId, westId, westId]);
  assert(distanceKm(again.regions.find((r) => r.id === westId)!, WEST_A) < 1, "centre stayed with the un-pinned members");
  assertEquals(again.regions.length, 1);
});

Deno.test("REQ-140 groupRegions — after a zone is dropped, a new zone takes an unused name and colour", () => {
  const far = (id: string, i: number) => sub(id, 33.5 + i * 0.2, -79.0);
  const first = groupRegions([far("a", 0), far("b", 1), far("c", 2), far("d", 3)], [], { newId, userId: "u" });
  assertEquals(first.regions.map((r) => r.name), ["Zona A", "Zona B", "Zona C", "Zona D"]);
  const bId = first.assignments.get("b")!;
  const second = groupRegions([far("a", 0), far("c", 2), far("d", 3), far("e", 5)], first.regions.filter((r) => r.id !== bId), { newId, userId: "u" });
  const names = second.regions.map((r) => r.name), colors = second.regions.map((r) => r.color);
  assertEquals(new Set(names).size, names.length, "names are unique: " + names.join(","));
  assertEquals(new Set(colors).size, colors.length, "colours are unique while the palette lasts");
});
