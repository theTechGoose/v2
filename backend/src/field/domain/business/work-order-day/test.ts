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
  assertEquals([...r.staff.crewIds].sort(), ["ana", "pedro"]);
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
