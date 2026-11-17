/**
 * REQ-840/841/842 — crews: who is in one, who leads it, which crew does a service on a zone,
 * who is out on a day and who stands in. Pure.
 */
import { assert, assertEquals } from "#std/assert";
import {
  availableMembers,
  canActOn,
  claimedBy,
  crewMembers,
  crewNameTaken,
  isOut,
  leadOf,
  nextAvailableDay,
  staffFor,
  staffOn,
} from "./mod.ts";
import type {
  Absence,
  Crew,
  FieldTask,
  FieldWorker,
  Region,
} from "@field/dto/field.ts";

const worker = (
  id: string,
  name: string,
  crewId?: string,
  role?: "foreman",
): FieldWorker => ({
  id,
  userId: "u",
  name,
  phoneNumber: id,
  pin: "1234",
  crewId,
  role,
  createdAt: "x",
  updatedAt: "x",
});
const crew = (id: string, name: string, o: Partial<Crew> = {}): Crew => ({
  id,
  userId: "u",
  name,
  color: "#000",
  taskTypeIds: [],
  createdAt: "x",
  updatedAt: "x",
  ...o,
});
const region = (id: string, o: Partial<Region> = {}): Region => ({
  id,
  userId: "u",
  name: id,
  color: "#000",
  lat: 0,
  lng: 0,
  ...o,
});
const task = (o: Partial<FieldTask>): FieldTask => ({
  id: "t",
  userId: "u",
  subscriptionId: "s",
  taskTypeId: "mow",
  customerId: "c",
  regionId: "z",
  workerId: "w1",
  date: "2026-11-16",
  priceCents: 1,
  status: "assigned",
  ...o,
});

// Grass crew: Ana leads Luis and Marco; Mulch crew: Pedro alone; Sol is in no crew
const ANA = worker("w1", "Ana", "grass"),
  LUIS = worker("w2", "Luis", "grass"),
  MARCO = worker("w3", "Marco", "grass");
const PEDRO = worker("w4", "Pedro", "mulch"), SOL = worker("w5", "Sol");
const WORKERS = [MARCO, LUIS, ANA, PEDRO, SOL];
const GRASS = crew("grass", "Grass crew", {
  foremanId: "w1",
  taskTypeIds: ["mow", "edge"],
});
const MULCH = crew("mulch", "Mulch crew", { taskTypeIds: ["mulch"] });
const ANY = crew("any", "Odd jobs", { taskTypeIds: [] });

Deno.test("REQ-840 crewMembers — the crew's workers, by name; leadOf — the foreman when present, else the first member; none for an empty crew", () => {
  assertEquals(crewMembers(GRASS, WORKERS).map((w) => w.name), [
    "Ana",
    "Luis",
    "Marco",
  ]);
  assertEquals(leadOf(GRASS, crewMembers(GRASS, WORKERS))?.id, "w1");
  assertEquals(
    leadOf(GRASS, [LUIS, MARCO])?.id,
    "w2",
    "the foreman away: the first member by name leads",
  );
  assertEquals(leadOf(MULCH, crewMembers(MULCH, WORKERS))?.id, "w4");
  assertEquals(leadOf(ANY, []), undefined);
});

Deno.test("REQ-840 crewNameTaken — the same name in another case or with accents is taken, its own name is not", () => {
  const all = [GRASS, MULCH];
  assert(crewNameTaken(all, "grass CREW"));
  assert(crewNameTaken(all, "  Mulch crew "));
  assert(!crewNameTaken(all, "Grass crew", "grass"));
  assert(!crewNameTaken(all, "Trees"));
});

Deno.test("REQ-840 claimedBy — the crew that lists a service, none when nobody does; the asking crew is left out", () => {
  assertEquals(claimedBy([GRASS, MULCH], "mow")?.id, "grass");
  assertEquals(claimedBy([GRASS, MULCH], "mulch")?.id, "mulch");
  assertEquals(claimedBy([GRASS, MULCH], "trees"), undefined);
  assertEquals(claimedBy([GRASS, MULCH], "mow", "grass"), undefined);
});

Deno.test("REQ-840 canActOn — the crew's foreman acts on the crew's tasks, a member on their own, the account foreman on anything", () => {
  const theirs = task({ crewId: "grass", workerId: "w2", crewIds: ["w3"] });
  assert(canActOn(ANA, theirs, GRASS), "the foreman, not on the task itself");
  assert(canActOn(LUIS, theirs, GRASS));
  assert(canActOn(MARCO, theirs, GRASS));
  assert(!canActOn(PEDRO, theirs, MULCH));
  assert(!canActOn(SOL, theirs, null));
  assert(canActOn(worker("boss", "Boss", undefined, "foreman"), theirs, null));
  assert(
    !canActOn(ANA, task({ crewId: "mulch", workerId: "w4" }), GRASS),
    "another crew's task",
  );
});

Deno.test("REQ-841 staffFor — the zone's crew that does the service takes it; else the catch-all crew; else the zone's worker; else uncovered", () => {
  const zone = region("z", { crewIds: ["grass", "mulch"], workerId: "w5" });
  const crews = [GRASS, MULCH, ANY];
  const mow = staffFor({
    region: zone,
    taskTypeId: "mow",
    crews,
    workers: WORKERS,
  });
  assertEquals(
    mow?.kind === "crew" && [mow.crew.id, mow.lead.id, mow.crewIds],
    ["grass", "w1", ["w2", "w3"]],
  );
  const mulch = staffFor({
    region: zone,
    taskTypeId: "mulch",
    crews,
    workers: WORKERS,
  });
  assertEquals(
    mulch?.kind === "crew" && [mulch.crew.id, mulch.lead.id, mulch.crewIds],
    ["mulch", "w4", []],
  );
  // a service no crew on the zone lists: the legacy worker
  assertEquals(
    staffFor({ region: zone, taskTypeId: "trees", crews, workers: WORKERS }),
    { kind: "worker", workerId: "w5" },
  );
  // no worker either: uncovered
  assertEquals(
    staffFor({
      region: region("z2", { crewIds: ["grass"] }),
      taskTypeId: "trees",
      crews,
      workers: WORKERS,
    }),
    null,
  );
  // the catch-all crew on the zone takes what nobody lists
  const odd = staffFor({
    region: region("z3", { crewIds: ["grass", "any"] }),
    taskTypeId: "trees",
    crews,
    workers: [...WORKERS, worker("w6", "Zed", "any")],
  });
  assertEquals(odd?.kind === "crew" && odd.crew.id, "any");
  // a zone with no crews: today's rule, the worker
  assertEquals(
    staffFor({
      region: region("z4", { workerId: "w5" }),
      taskTypeId: "mow",
      crews,
      workers: WORKERS,
    }),
    { kind: "worker", workerId: "w5" },
  );
  assertEquals(
    staffFor({
      region: region("z5"),
      taskTypeId: "mow",
      crews,
      workers: WORKERS,
    }),
    null,
  );
});

Deno.test("REQ-841 staffFor — order decides between two crews that both do it; coversAll crews are staff everywhere (after the zone's own); a crew with no members is skipped", () => {
  const north = crew("north", "Grass North", { taskTypeIds: ["mow"] }),
    south = crew("south", "Grass South", { taskTypeIds: ["mow"] });
  const ws = [worker("n1", "Nia", "north"), worker("s1", "Sam", "south")];
  const a = staffFor({
    region: region("z", { crewIds: ["south", "north"] }),
    taskTypeId: "mow",
    crews: [north, south],
    workers: ws,
  });
  assertEquals(a?.kind === "crew" && a.crew.id, "south");
  // mulch covers every zone — a zone that lists only the grass crew still sends mulch to it
  const mulchAll = crew("mulch", "Mulch crew", {
    taskTypeIds: ["mulch"],
    coversAll: true,
  });
  const m = staffFor({
    region: region("z", { crewIds: ["north"] }),
    taskTypeId: "mulch",
    crews: [north, mulchAll],
    workers: [...ws, PEDRO],
  });
  assertEquals(m?.kind === "crew" && m.crew.id, "mulch");
  // the zone's own crew wins over a coversAll crew for the same service
  const mowAll = crew("mowall", "Mow everywhere", {
    taskTypeIds: ["mow"],
    coversAll: true,
  });
  const own = staffFor({
    region: region("z", { crewIds: ["north"] }),
    taskTypeId: "mow",
    crews: [mowAll, north],
    workers: [...ws, worker("m1", "Mo", "mowall")],
  });
  assertEquals(own?.kind === "crew" && own.crew.id, "north");
  // no members → not staff
  const empty = staffFor({
    region: region("z", { crewIds: ["north"], workerId: "w5" }),
    taskTypeId: "mow",
    crews: [north],
    workers: [SOL],
  });
  assertEquals(empty, { kind: "worker", workerId: "w5" });
});

const out = (o: Partial<Absence>): Absence => ({
  id: "a",
  userId: "u",
  from: "2026-11-16",
  to: "2026-11-18",
  disposition: "skip",
  createdAt: "x",
  ...o,
});

Deno.test("REQ-842 isOut / availableMembers — an absence covers its days inclusive, for the worker or the crew named; absent members leave the day's crew", () => {
  const luisOut = out({ workerId: "w2" });
  assertEquals(isOut([luisOut], { workerId: "w2" }, "2026-11-16")?.id, "a");
  assertEquals(isOut([luisOut], { workerId: "w2" }, "2026-11-18")?.id, "a");
  assertEquals(isOut([luisOut], { workerId: "w2" }, "2026-11-19"), undefined);
  assertEquals(isOut([luisOut], { workerId: "w2" }, "2026-11-15"), undefined);
  assertEquals(
    isOut([luisOut], { crewId: "grass" }, "2026-11-16"),
    undefined,
    "a worker's absence is not the crew's",
  );
  assertEquals(
    isOut([out({ crewId: "grass" })], { crewId: "grass" }, "2026-11-17")?.id,
    "a",
  );
  assertEquals(
    availableMembers(GRASS, WORKERS, [luisOut], "2026-11-16").map((w) =>
      w.name
    ),
    ["Ana", "Marco"],
  );
  assertEquals(
    availableMembers(GRASS, WORKERS, [luisOut], "2026-11-20").map((w) =>
      w.name
    ),
    ["Ana", "Luis", "Marco"],
  );
});

Deno.test("REQ-842 staffOn — a member out: the rest go (the foreman out → the next leads); the crew out or emptied: the disposition — cover by a crew or a worker, defer to the next day they are back, skip", () => {
  const zone = region("z", { crewIds: ["grass", "mulch"] });
  const base = {
    region: zone,
    taskTypeId: "mow",
    crews: [GRASS, MULCH],
    workers: WORKERS,
  };
  // Ana (the foreman) out: Luis leads Marco
  const anaOut = staffOn({
    ...base,
    absences: [out({ workerId: "w1" })],
    date: "2026-11-16",
  });
  assertEquals(
    anaOut?.kind === "staff" && anaOut.staff.kind === "crew" &&
      [anaOut.staff.lead.id, anaOut.staff.crewIds],
    ["w2", ["w3"]],
  );
  // the whole crew out, covered by the mulch crew
  const covered = staffOn({
    ...base,
    absences: [
      out({ crewId: "grass", disposition: "cover", coverCrewId: "mulch" }),
    ],
    date: "2026-11-17",
  });
  assertEquals(
    covered?.kind === "cover" && covered.staff.kind === "crew" &&
      [covered.staff.crew.id, covered.coverFor],
    ["mulch", "grass"],
  );
  // covered by one worker
  const solo = staffOn({
    ...base,
    absences: [
      out({ crewId: "grass", disposition: "cover", coverWorkerId: "w5" }),
    ],
    date: "2026-11-17",
  });
  assertEquals(solo?.kind === "cover" && solo.staff, {
    kind: "worker",
    workerId: "w5",
  });
  // every member out one by one: the crew is out; skip
  const allOut = [
    out({ workerId: "w1" }),
    out({ workerId: "w2" }),
    out({ workerId: "w3", disposition: "skip" }),
  ];
  const skipped = staffOn({ ...base, absences: allOut, date: "2026-11-16" });
  assertEquals(skipped?.kind, "skip");
  // defer: the next day the crew is back — the 19th
  const deferred = staffOn({
    ...base,
    absences: [out({ crewId: "grass", disposition: "defer" })],
    date: "2026-11-16",
  });
  assertEquals(deferred?.kind === "defer" && deferred.to, "2026-11-19");
  assertEquals(
    nextAvailableDay(
      { ...base, absences: [out({ crewId: "grass" })] },
      "2026-11-16",
    ),
    "2026-11-19",
  );
  assertEquals(
    nextAvailableDay({
      ...base,
      absences: [out({ crewId: "grass", to: "2027-01-30" })],
    }, "2026-11-16"),
    null,
    "nobody back within 31 days",
  );
  // the cover crew is out too: uncovered
  const bothOut = staffOn({
    ...base,
    absences: [
      out({ crewId: "grass", disposition: "cover", coverCrewId: "mulch" }),
      out({ id: "b", crewId: "mulch" }),
    ],
    date: "2026-11-17",
  });
  assertEquals(bothOut, null);
  // nobody out: plain staff
  const plain = staffOn({ ...base, absences: [], date: "2026-11-16" });
  assertEquals(plain?.kind, "staff");
  // a legacy solo worker out, deferred
  const legacy = staffOn({
    region: region("z2", { workerId: "w5" }),
    taskTypeId: "mow",
    crews: [],
    workers: WORKERS,
    absences: [out({ workerId: "w5", disposition: "defer", to: "2026-11-16" })],
    date: "2026-11-16",
  });
  assertEquals(legacy?.kind === "defer" && legacy.to, "2026-11-17");
});
