/**
 * REQ-1010 (LOOP-007 q1-96) — which work orders are on a worker's day, and what the worker sees of one.
 */
import { assertEquals } from "#std/assert";
import type { WorkOrder } from "@paperwork/dto/work-order.ts";
import { onWorkOrderDay, workOrderRow, workOrdersOn } from "./mod.ts";
import * as day from "./mod.ts";
import type { Absence, Crew, FieldWorker } from "@field/dto/field.ts";

const wo = (o: Partial<WorkOrder> = {}): WorkOrder => ({
  id: "wo1",
  userId: "u1",
  number: "WO-001",
  description: "Replace the back fence gate",
  scheduledFor: "2026-11-24",
  assigneeWorkerId: "mike",
  assignee: "Mike Carter",
  status: "open",
  notes: "office only",
  createdAt: "",
  updatedAt: "",
  ...o,
} as WorkOrder);
const names = {
  customer: (id: string) => (id === "c1" ? "Dana Whitfield" : "—"),
  worker: (id: string) => (id === "mike" ? "Mike Carter" : "—"),
};

Deno.test("REQ-1010 a work order is on its assigned worker's scheduled day only, and never once cancelled", () => {
  assertEquals(onWorkOrderDay(wo(), "mike", "2026-11-24"), true);
  assertEquals(onWorkOrderDay(wo(), "pedro", "2026-11-24"), false);
  assertEquals(onWorkOrderDay(wo(), "mike", "2026-11-25"), false);
  assertEquals(
    onWorkOrderDay(wo({ status: "cancelled" }), "mike", "2026-11-24"),
    false,
  );
  assertEquals(
    onWorkOrderDay(wo({ assigneeWorkerId: undefined }), "mike", "2026-11-24"),
    false,
  );
  assertEquals(
    workOrdersOn([
      wo(),
      wo({ id: "x", assigneeWorkerId: undefined }),
      wo({ id: "y", status: "cancelled" }),
    ], "2026-11-24").map((w) => w.id),
    ["wo1"],
  );
});

Deno.test("REQ-1010 the worker's row of a work order: its job, customer, address, number — no notes, no price", () => {
  const r = workOrderRow(
    wo({ customerId: "c1", serviceAddress: "12 Fence Row" }),
    names,
  );
  assertEquals(r.workOrderId, "wo1");
  assertEquals(r.workOrderNumber, "WO-001");
  assertEquals(r.taskTypeName, "Replace the back fence gate");
  assertEquals(r.customerName, "Dana Whitfield");
  assertEquals(r.address, "12 Fence Row");
  assertEquals(r.workerId, "mike");
  assertEquals(r.status, "assigned");
  assertEquals("notes" in r || "priceCents" in r, false);
  assertEquals(workOrderRow(wo({ status: "done" }), names).status, "complete");
  // no customer: the WO's number stands in; a deleted customer keeps the filed name
  assertEquals(workOrderRow(wo(), names).customerName, "WO-001");
  assertEquals(
    workOrderRow(
      wo({
        customerId: "gone",
        customerSnapshot: { name: "Old Name" } as WorkOrder["customerSnapshot"],
      }),
      names,
    ).customerName,
    "Old Name",
  );
});

// ---------------------------------------------------------------------------------------------
// REQ-1022 (LOOP-007 cycle 2, q2-12) — amends REQ-842 / REQ-1010: a work order's assignee who is
// marked out on its day is resolved like a field task's staff (crews/mod.ts staffOn). Expected
// contract: `woStaffOn(wo, { absences, workers, crews, date })` → the same `Resolution` shape
// staffOn returns (crews/mod.ts) — `{ kind: "staff" | "cover" | "defer" | "skip", staff, ... }`,
// `coverFor` = the absent assignee on a cover, null when the cover is out too. Defer/skip never
// move the stored date (the result only flags it).
// ---------------------------------------------------------------------------------------------

const D = "2026-11-20";
const fw = (id: string, name: string, o: Partial<FieldWorker> = {}): FieldWorker => ({
  id,
  userId: "u1",
  name,
  phoneNumber: "8435550000",
  pin: "1234",
  createdAt: "",
  updatedAt: "",
  ...o,
});
const jake = fw("jake", "Jake Fowler");
const miguel = fw("miguel", "Miguel Torres");
const ana = fw("ana", "Ana Ruiz", { crewId: "mulch" });
const pedro = fw("pedro", "Pedro Gil", { crewId: "mulch" });
const mulch: Crew = {
  id: "mulch",
  userId: "u1",
  name: "Mulch crew",
  color: "#0a0",
  foremanId: "ana",
  taskTypeIds: [],
  createdAt: "",
  updatedAt: "",
};
const out = (o: Partial<Absence>): Absence => ({
  id: "a1",
  userId: "u1",
  workerId: "jake",
  from: D,
  to: D,
  disposition: "cover",
  createdAt: "",
  ...o,
});
const jakesWo = () => wo({ assigneeWorkerId: "jake", assignee: "Jake Fowler", scheduledFor: D });
const base = { workers: [jake, miguel, ana, pedro], crews: [mulch], date: D };

// deno-lint-ignore no-explicit-any
type Resolver = (wo: WorkOrder, input: Record<string, unknown>) => any;
function resolver(): Resolver {
  const fn = (day as Record<string, unknown>).woStaffOn;
  assertEquals(
    typeof fn,
    "function",
    "REQ-1022: work-order-day/mod.ts exports woStaffOn(wo, { absences, workers, crews, date }) — today a WO's day ignores absences entirely",
  );
  return fn as Resolver;
}

Deno.test("REQ-1022 (LOOP-007 q2-12) Jake out on D covered by Miguel: Jake's WO-001 resolves to Miguel, coverFor Jake", () => {
  const r = resolver()(jakesWo(), { ...base, absences: [out({ coverWorkerId: "miguel" })] });
  assertEquals(r?.kind, "cover", "the WO goes to the cover");
  assertEquals(r.staff, { kind: "worker", workerId: "miguel" }, "Miguel does WO-001");
  assertEquals(r.coverFor, "jake", "covering for Jake");
});

Deno.test("REQ-1022 (LOOP-007 q2-12) Jake not out (or out another day): the WO stays with Jake", () => {
  const r = resolver()(jakesWo(), {
    ...base,
    absences: [out({ from: "2026-11-21", to: "2026-11-22", coverWorkerId: "miguel" })],
  });
  assertEquals(r?.kind, "staff");
  assertEquals(r.staff, { kind: "worker", workerId: "jake" });
});

Deno.test("REQ-1022 (LOOP-007 q2-12) Jake out covered by a crew: the crew's lead and available members take the WO", () => {
  const r = resolver()(jakesWo(), { ...base, absences: [out({ coverCrewId: "mulch" })] });
  assertEquals(r?.kind, "cover");
  assertEquals(r.staff.kind, "crew");
  assertEquals(r.staff.lead.id, "ana", "the crew's foreman leads it");
  // Staff.crewIds is the crew's OTHER workers (crews/mod.ts crewStaff) — the lead + them is the whole crew
  assertEquals([r.staff.lead.id, ...r.staff.crewIds].sort(), ["ana", "pedro"]);
  assertEquals(r.coverFor, "jake");
});

Deno.test("REQ-1022 (LOOP-007 q2-12) the cover is out too: nobody has the WO (null), never silently Jake", () => {
  const r = resolver()(jakesWo(), {
    ...base,
    absences: [
      out({ coverWorkerId: "miguel" }),
      out({ id: "a2", workerId: "miguel", disposition: "skip" }),
    ],
  });
  assertEquals(r, null);
});

Deno.test("REQ-1022 (LOOP-007 q2-12) Jake out with defer or skip: the WO is flagged, its stored date untouched", () => {
  const w = jakesWo();
  const deferred = resolver()(w, { ...base, absences: [out({ disposition: "defer" })] });
  assertEquals(deferred?.kind, "defer");
  const skipped = resolver()(w, { ...base, absences: [out({ disposition: "skip" })] });
  assertEquals(skipped?.kind, "skip");
  assertEquals(w.scheduledFor, D, "the WO's date is not moved by the resolver");
});

// ---------------------------------------------------------------------------------------------
// REQ-1163 (LOOP-007 cycle 3, q3-96) — AMENDMENT of REQ-1022: "Deferred to the day they are back"
// moves the work order to that day (at read time; the stored WO is untouched). QA marked Luis out
// on D with defer; the owner's Away row said "WO-001 … nobody has it" while Luis's /worker day D
// still listed WO-001 as an ordinary to-do. Expected contract:
//   woDayPlacement(wo, { absences, workers, crews }) → { date, staff, deferredFrom?, out? }
//   defer with a day back within MAX_DEFER_DAYS → { date: that day, deferredFrom: scheduledFor }
//   skip, or defer with no day back → { date: scheduledFor, out: "skip" | "defer" }
// and onWorkOrderDay(wo, worker, day, people) follows the placement.
// ---------------------------------------------------------------------------------------------

const luis = fw("luis", "Luis Ortega");
const D1 = "2026-11-21";
const luisWo = () =>
  wo({ number: "WO-001", description: "Replace pool pump seal", assigneeWorkerId: "luis", assignee: "Luis Ortega", scheduledFor: D });
const luisOut = (o: Partial<Absence>) => out({ workerId: "luis", ...o });
const luisPeople = (absences: Absence[]) => ({ workers: [luis, jake, miguel, ana, pedro], crews: [mulch], absences });

// deno-lint-ignore no-explicit-any
type Placer = (wo: WorkOrder, people: Record<string, unknown>) => any;
function placer(): Placer {
  const fn = (day as Record<string, unknown>).woDayPlacement;
  assertEquals(
    typeof fn,
    "function",
    "REQ-1163 (q3-96): work-order-day/mod.ts exports woDayPlacement(wo, { absences, workers, crews }) → { date, staff, deferredFrom?, out? } — today a defer only flags the resolution and both readers drop its `to`",
  );
  return fn as Placer;
}

Deno.test("REQ-1163 (LOOP-007 q3-96) Luis out on D with defer, back on D+1: WO-001 is off his day D and on D+1 (deferred from D)", () => {
  const w = luisWo();
  const people = luisPeople([luisOut({ disposition: "defer" })]);
  assertEquals(
    onWorkOrderDay(w, "luis", D, people),
    false,
    "Luis is off on D and the owner picked 'Deferred to the day they are back': WO-001 is not on his day D (QA saw it listed as '1 por hacer')",
  );
  assertEquals(onWorkOrderDay(w, "luis", D1, people), true, "WO-001 is on Luis's first day back, D+1");
  const p = placer()(w, people);
  assertEquals(p?.date, D1, "placed on the day Luis is back");
  assertEquals(p?.deferredFrom, D, "carries the day it was deferred from");
  assertEquals(p?.staff?.workerId, "luis", "still Luis's");
  assertEquals(w.scheduledFor, D, "the stored WO is untouched");
});

Deno.test("REQ-1163 (LOOP-007 q3-96) Luis out on D with skip: WO-001 stays on D flagged out:'skip'", () => {
  const w = luisWo();
  const people = luisPeople([luisOut({ disposition: "skip" })]);
  const p = placer()(w, people);
  assertEquals(p?.date, D, "a skip does not move it");
  assertEquals(p?.out, "skip", "flagged: the office reschedules it");
  assertEquals(p?.deferredFrom, undefined);
  assertEquals(onWorkOrderDay(w, "luis", D1, people), false, "never on the next day");
});

Deno.test("REQ-1163 (LOOP-007 q3-96) Luis out with defer and no day back within MAX_DEFER_DAYS: WO-001 stays on D flagged out:'defer'", () => {
  const w = luisWo();
  const people = luisPeople([luisOut({ disposition: "defer", to: "2027-03-01" })]);
  const p = placer()(w, people);
  assertEquals(p?.date, D, "no day back to move it to");
  assertEquals(p?.out, "defer", "flagged for the office");
});
// the worker's row (deferredFrom / out) is pinned over HTTP in
// backend/src/paperwork/entrypoints/work-order-controller/worker-view.int.test.ts (REQ-1163).
