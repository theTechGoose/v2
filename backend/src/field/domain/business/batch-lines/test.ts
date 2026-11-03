/** REQ-142 — a batch pull: completed, un-invoiced tasks in a range → one draft per customer, one line per task. */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { lineText, linesFor, summarize } from "./mod.ts";
import type { FieldTask, Subscription, TaskType } from "@field/dto/field.ts";

const taskTypes: TaskType[] = [{ id: "tt1", userId: "u", name: "Lawn cut", createdAt: "x" }, { id: "tt2", userId: "u", name: "Hedge trim", createdAt: "x" }];
const subscriptions: Subscription[] = [
  { id: "s1", userId: "u", customerId: "c1", address: "123 Oak St", lat: 0, lng: 0, items: [], cadence: "weekly", active: true, createdAt: "x", updatedAt: "x" },
  { id: "s2", userId: "u", customerId: "c2", address: "9 Pine Ave", lat: 0, lng: 0, items: [], cadence: "weekly", active: true, createdAt: "x", updatedAt: "x" },
];
const task = (id: string, o: Partial<FieldTask>): FieldTask => ({
  id, userId: "u", subscriptionId: "s1", taskTypeId: "tt1", customerId: "c1", regionId: "r", workerId: "w", date: "2026-10-12",
  priceCents: 6500, status: "complete", ...o,
});
const base = { from: "2026-10-01", to: "2026-10-31", subscriptions, taskTypes, liveInvoiceIds: new Set(["old"]) };

Deno.test("REQ-142 linesFor — only completed tasks inside the range are pulled", () => {
  const out = linesFor({ ...base, tasks: [task("t1", {}), task("t2", { status: "assigned" }), task("t3", { date: "2026-09-30" }), task("t4", { status: "skipped" }), task("t5", { status: "deferred" })] });
  assertEquals(out.length, 1);
  assertEquals(out[0].lines.map((l) => l.taskId), ["t1"]);
});

Deno.test("REQ-142 linesFor — a task on a live invoice is never pulled again; one whose invoice is gone is", () => {
  const out = linesFor({ ...base, tasks: [task("t1", { invoiceId: "old" }), task("t2", {}), task("t3", { invoiceId: "deleted-draft" })] });
  assertEquals(out[0].lines.map((l) => l.taskId), ["t2", "t3"]);
});

Deno.test("REQ-142 linesFor — one group per customer, one line per task priced from the task, with the total", () => {
  const out = linesFor({ ...base, tasks: [task("t1", {}), task("t2", { taskTypeId: "tt2", priceCents: 4000 }), task("t3", { subscriptionId: "s2", customerId: "c2" })] });
  assertEquals(out.map((g) => g.customerId).sort(), ["c1", "c2"]);
  const ana = out.find((g) => g.customerId === "c1")!;
  assertEquals([ana.lines.length, ana.amount], [2, 10500]);
  assertEquals(ana.lines[0].address, "123 Oak St");
});

Deno.test("REQ-142 lineText — date — task — address (the invoice line item's description)", () => {
  const [g] = linesFor({ ...base, tasks: [task("t1", {})] });
  assertEquals(lineText(g.lines[0], "en"), "Oct 12 — Lawn cut — 123 Oak St");
  assertEquals(lineText(g.lines[0], "es"), "12 oct — Lawn cut — 123 Oak St");
});

Deno.test("REQ-142 linesFor — the worker's note does not carry over", () => {
  const [g] = linesFor({ ...base, tasks: [task("t1", { note: "gate was locked, cut front only" })] });
  const json = JSON.stringify(g);
  assertEquals(json.includes("gate was locked"), false);
  assertStringIncludes(json, "Lawn cut");
});

Deno.test("REQ-142 summarize — what was and was not billed in the range", () => {
  const t = (id: string, status: FieldTask["status"], date: string, invoiceId?: string, priceCents = 6500): FieldTask => ({ id, userId: "u", subscriptionId: "s", taskTypeId: "1", customerId: "c", regionId: "r", workerId: "w", date, status, priceCents, invoiceId });
  const sum = summarize({ from: "2026-10-01", to: "2026-10-31", liveInvoiceIds: new Set(["inv1"]), tasks: [t("a", "complete", "2026-10-05"), t("b", "skipped", "2026-10-05"), t("c", "assigned", "2026-10-12"), t("d", "complete", "2026-10-12", "inv1"), t("e", "complete", "2026-09-30"), t("f", "complete", "2026-10-19", undefined, 0), t("g", "deferred", "2026-10-20")] });
  assertEquals(sum, { pullable: 2, skipped: 1, deferred: 1, open: 1, alreadyInvoiced: 1, zeroPriced: 1 });
});
