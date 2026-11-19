/**
 * REQ-1010 (LOOP-007 q1-96) — which work orders are on a worker's day, and what the worker sees of one.
 */
import { assertEquals } from "#std/assert";
import type { WorkOrder } from "@paperwork/dto/work-order.ts";
import { onWorkOrderDay, workOrderRow, workOrdersOn } from "./mod.ts";

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
