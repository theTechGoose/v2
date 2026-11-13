/** REQ-142 — a batch pull: completed, un-invoiced tasks in a range → one draft per customer, one line per task. */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { batchTitle, lineItem, lineText, linesFor, summarize, taskForItem, withoutLine } from "./mod.ts";
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

// REQ-173 — the batch writes structured line items: the description stays for compatibility,
// and date / service / address let every surface group the visits under the address
Deno.test("REQ-173 lineItem — description + date + service + address, priced from the task", () => {
  const l = { taskId: "t1", date: "2026-10-02", description: "Lawn", address: "725 Frederick Rd, Rockingham, VA", priceCents: 6500 };
  assertEquals(lineItem(l, "en"), {
    description: "Oct 2 — Lawn — 725 Frederick Rd, Rockingham, VA",
    quantity: 1,
    unit: "visit",
    price: 6500,
    date: "2026-10-02",
    service: "Lawn",
    address: "725 Frederick Rd, Rockingham, VA",
    taskId: "t1", // REQ-810: the line names its task
  });
  assertEquals(lineItem(l, "es").unit, "visita");
});

// REQ-703 (demo-loop cycle 5, m54): a one-off repair was invoiced as "Maintenance 2026-10-29 → 2026-11-12".
// The title comes from the group's own lines; the period goes in serviceDateFrom/To, localized in the title.
Deno.test("REQ-703 batchTitle — one task is titled by its service, never 'Maintenance'", () => {
  const fence: TaskType = { id: "tt9", userId: "u", name: "Fix 3 sagging fence posts", createdAt: "x" };
  const [g] = linesFor({ ...base, taskTypes: [...taskTypes, fence], tasks: [task("t1", { subscriptionId: "", oneOff: true, taskTypeId: "tt9", date: "2026-10-29" })] });
  assertEquals(batchTitle(g.lines, "en"), { jobName: "Fix 3 sagging fence posts", serviceDateFrom: "2026-10-29", serviceDateTo: "2026-10-29" });
  assertEquals(batchTitle(g.lines, "es").jobName, "Fix 3 sagging fence posts");
});

Deno.test("REQ-703 batchTitle — subscription visits only → 'Maintenance · Oct 12 – Oct 26' (es localized), period from the lines", () => {
  const [g] = linesFor({ ...base, tasks: [task("t1", {}), task("t2", { date: "2026-10-26" }), task("t3", { taskTypeId: "tt2", date: "2026-10-19" })] });
  assertEquals(batchTitle(g.lines, "en"), { jobName: "Maintenance · Oct 12 – Oct 26", serviceDateFrom: "2026-10-12", serviceDateTo: "2026-10-26" });
  assertEquals(batchTitle(g.lines, "es").jobName, "Mantenimiento · 12 oct – 26 oct");
});

Deno.test("REQ-703 batchTitle — a round plus a one-off → 'Services · …'; never raw ISO dates", () => {
  const [g] = linesFor({ ...base, tasks: [task("t1", {}), task("t2", { subscriptionId: "", oneOff: true, taskTypeId: "tt2", date: "2026-10-20" })] });
  assertEquals(batchTitle(g.lines, "en").jobName, "Services · Oct 12 – Oct 20");
  assertEquals(batchTitle(g.lines, "es").jobName, "Servicios · 12 oct – 20 oct");
  // two visits the same day → one date, not "Oct 12 – Oct 12"
  const [same] = linesFor({ ...base, tasks: [task("t1", {}), task("t3", { taskTypeId: "tt2" })] });
  assertEquals(batchTitle(same.lines, "en").jobName, "Maintenance · Oct 12");
  for (const lang of ["en", "es"] as const) assertEquals(/\d{4}-\d{2}-\d{2}/.test(batchTitle(g.lines, lang).jobName), false);
});

// REQ-788 — "a toggle button … that adds an overhead cost. that overhead cost is defined in settings."
const withOverhead: Subscription[] = [
  { ...subscriptions[0], overhead: true },
  subscriptions[1],
];
Deno.test("REQ-788 linesFor — a subscription with the toggle on bills one Overhead line per visit, at the Settings amount, on top of its services", () => {
  const out = linesFor({
    ...base,
    subscriptions: withOverhead,
    overhead: { label: "Overhead", setting: { mode: "flat", cents: 2500 } },
    tasks: [task("t1", {}), task("t2", { taskTypeId: "tt2", priceCents: 4000 }), task("t3", { date: "2026-10-19" }), task("t4", { subscriptionId: "s2", customerId: "c2" })],
  });
  const ana = out.find((g) => g.customerId === "c1")!;
  // two visits (Oct 12 with two services, Oct 19 with one) → two overhead lines
  const oh = ana.lines.filter((l) => l.overhead);
  assertEquals(oh.map((l) => [l.date, l.description, l.priceCents, l.address]), [["2026-10-12", "Overhead", 2500, "123 Oak St"], ["2026-10-19", "Overhead", 2500, "123 Oak St"]]);
  assertEquals(ana.amount, 6500 + 4000 + 6500 + 2500 * 2);
  // the overhead line follows the visit's services and names no task
  assertEquals(ana.lines.map((l) => l.taskId), ["t2", "t1", "", "t3", ""]); // services by name (Hedge, Lawn), then the overhead
  // the other customer's subscription has the toggle off — services only
  const bob = out.find((g) => g.customerId === "c2")!;
  assertEquals([bob.lines.length, bob.amount], [1, 6500]);
});

Deno.test("REQ-788 linesFor — no overhead line when the toggle is off, when the amount is 0, or when Settings has none", () => {
  const tasks = [task("t1", {})];
  assertEquals(linesFor({ ...base, tasks, overhead: { label: "Overhead", setting: { mode: "flat", cents: 2500 } } })[0].lines.length, 1);
  assertEquals(linesFor({ ...base, subscriptions: withOverhead, tasks, overhead: { label: "Overhead", setting: { mode: "flat", cents: 0 } } })[0].lines.length, 1);
  assertEquals(linesFor({ ...base, subscriptions: withOverhead, tasks })[0].lines.length, 1);
});

Deno.test("REQ-788 lineItem — the overhead line is a priced line on the visit's date and address, in the invoice's language", () => {
  const [g] = linesFor({ ...base, subscriptions: withOverhead, tasks: [task("t1", {})], overhead: { label: "Gastos generales", setting: { mode: "flat", cents: 2500 } } });
  const item = lineItem(g.lines[1], "es");
  assertEquals([item.description, item.price, item.date, item.service, item.address], ["12 oct — Gastos generales — 123 Oak St", 2500, "2026-10-12", "Gastos generales", "123 Oak St"]);
});

// REQ-788 AMENDMENT — "we want it in percentage, or in dollars"
Deno.test("REQ-788 AMENDMENT linesFor — a percent overhead bills that share of each visit's services, rounded to the cent; 0% bills none", () => {
  const pct = (p: number) => ({ label: "Overhead", setting: { mode: "percent" as const, pct: p } });
  const out = linesFor({
    ...base,
    subscriptions: withOverhead,
    overhead: pct(10),
    tasks: [task("t1", {}), task("t2", { taskTypeId: "tt2", priceCents: 4000 }), task("t3", { date: "2026-10-19", priceCents: 6505 })],
  });
  const [g] = out;
  assertEquals(g.lines.filter((l) => l.overhead).map((l) => [l.date, l.priceCents]), [["2026-10-12", 1050], ["2026-10-19", 651]]); // 650.5 → 651
  assertEquals(g.amount, 6500 + 4000 + 6505 + 1050 + 651);
  assertEquals(linesFor({ ...base, subscriptions: withOverhead, overhead: pct(0), tasks: [task("t1", {})] })[0].lines.length, 1);
  // the flat setting still bills the amount
  assertEquals(linesFor({ ...base, subscriptions: withOverhead, overhead: { label: "Overhead", setting: { mode: "flat", cents: 2500 } }, tasks: [task("t1", {})] })[0].lines[1].priceCents, 2500);
});

// REQ-810 — "i need a way to remove invoices from a batch and a way to remove a row from batch."
// A line names its task from now on; an older line is matched to its invoice's tasks — never a guess.
Deno.test("REQ-810 lineItem — a task line carries its taskId; an overhead line carries overhead: true and no taskId", () => {
  const [g] = linesFor({ ...base, subscriptions: withOverhead, tasks: [task("t1", {})], overhead: { label: "Overhead", setting: { mode: "flat", cents: 2500 } } });
  const [svc, oh] = g.lines.map((l) => lineItem(l, "en"));
  assertEquals([svc.taskId, svc.overhead], ["t1", undefined]);
  assertEquals([oh.taskId, oh.overhead], [undefined, true]);
});

const invTasks = () => linesFor({ ...base, subscriptions: withOverhead, overhead: { label: "Overhead", setting: { mode: "flat", cents: 2500 } }, tasks: [task("t1", {}), task("t2", { taskTypeId: "tt2", priceCents: 4000 }), task("t3", { date: "2026-10-19" })] })[0].lines;
/** an invoice pulled before REQ-810: the same items, minus taskId / overhead */
const oldItems = () => invTasks().map((l) => {
  const { taskId: _t, overhead: _o, ...rest } = lineItem(l, "en");
  return rest;
});

Deno.test("REQ-810 taskForItem — a new line's taskId wins; an older line matches its task by date + service + address (+ price); the overhead line names none", () => {
  const lines = invTasks();
  const items = lines.map((l) => lineItem(l, "en"));
  assertEquals(items.map((i) => taskForItem(i, lines)), ["t2", "t1", null, "t3", null]);
  assertEquals(oldItems().map((i) => taskForItem(i, lines)), ["t2", "t1", null, "t3", null]);
  // a taskId that is not one of the invoice's tasks frees nothing (it was re-billed elsewhere)
  assertEquals(taskForItem({ ...items[0], taskId: "elsewhere" }, lines), null);
});

Deno.test("REQ-810 taskForItem — no unique match frees nothing: an edited price, a renamed service, two identical visits", () => {
  const lines = invTasks();
  const [hedge] = oldItems();
  assertEquals(taskForItem({ ...hedge, service: "Hedge trim deluxe" }, lines), null);
  assertEquals(taskForItem({ ...hedge, address: "1 Elm St" }, lines), null);
  // price only breaks a tie: alone it does not stop a match
  assertEquals(taskForItem({ ...hedge, price: 4100 }, lines), "t2");
  const twins = linesFor({ ...base, tasks: [task("a", {}), task("b", {})] })[0].lines;
  const { taskId: _t, ...old } = lineItem(twins[0], "en");
  assertEquals(taskForItem(old, twins), null);
  // twins at different prices: the price picks one
  const priced = linesFor({ ...base, tasks: [task("a", {}), task("b", { priceCents: 7000 })] })[0].lines;
  const { taskId: _u, ...oldB } = lineItem(priced.find((l) => l.taskId === "b")!, "en");
  assertEquals(taskForItem(oldB, priced), "b");
});

Deno.test("REQ-810 withoutLine — the line leaves; amount, description, title and dates are recomputed from what is left; its task is freed", () => {
  const lines = invTasks();
  const items = lines.map((l) => lineItem(l, "en"));
  // drop the Oct 19 Lawn visit (that visit's overhead line stays until it is removed too)
  const r = withoutLine(items, 3, lines, "en");
  assertEquals(r.freedTaskId, "t3");
  assertEquals(r.last, false);
  assertEquals(r.patch.lineItems.length, 4);
  assertEquals(r.patch.amount, 4000 + 6500 + 2500 + 2500);
  assertEquals(r.patch.description, items.filter((_, i) => i !== 3).map((i) => i.description).join("\n"));
  assertEquals([r.patch.jobName, r.patch.serviceDateFrom, r.patch.serviceDateTo], ["Maintenance · Oct 12 – Oct 19", "2026-10-12", "2026-10-19"]);
  // then its overhead line too → Oct 12 only
  const lines2 = lines.filter((l) => l.taskId !== "t3");
  const r2 = withoutLine(r.patch.lineItems, 3, lines2, "en");
  assertEquals([r2.freedTaskId, r2.patch.amount, r2.patch.jobName, r2.patch.serviceDateTo], [null, 4000 + 6500 + 2500, "Maintenance · Oct 12", "2026-10-12"]);
});

Deno.test("REQ-810 withoutLine — the overhead line just leaves (nothing freed); the last task line (only overhead left) is last", () => {
  const lines = invTasks();
  const items = lines.map((l) => lineItem(l, "en"));
  const oh = withoutLine(items, 2, lines, "en");
  assertEquals([oh.freedTaskId, oh.last, oh.patch.amount], [null, false, 4000 + 6500 + 6500 + 2500]);
  // one visit + its overhead: removing the visit leaves only overhead → last
  const one = linesFor({ ...base, subscriptions: withOverhead, overhead: { label: "Overhead", setting: { mode: "flat", cents: 2500 } }, tasks: [task("t1", {})] })[0].lines;
  const r = withoutLine(one.map((l) => lineItem(l, "en")), 0, one, "en");
  assertEquals([r.freedTaskId, r.last], ["t1", true]);
  // an older invoice: the overhead line is known by its label
  const { taskId: _t, overhead: _o, ...oldSvc } = lineItem(one[0], "es");
  const { taskId: _u, overhead: _p, ...oldOh } = lineItem({ ...one[1], description: "Gastos generales" }, "es");
  assertEquals(withoutLine([oldSvc, oldOh], 0, one, "es").last, true);
  // a single task line, no overhead: last
  const solo = linesFor({ ...base, tasks: [task("t9", {})] })[0].lines;
  assertEquals(withoutLine(solo.map((l) => lineItem(l, "en")), 0, solo, "en").last, true);
});

Deno.test("REQ-810 withoutLine — an older line with no unique task match still leaves; nothing is freed", () => {
  const twins = linesFor({ ...base, tasks: [task("a", {}), task("b", {})] })[0].lines;
  const items = twins.map((l) => {
    const { taskId: _t, ...rest } = lineItem(l, "en");
    return rest;
  });
  const r = withoutLine(items, 0, twins, "en");
  assertEquals([r.freedTaskId, r.last, r.patch.lineItems.length, r.patch.amount], [null, false, 1, 6500]);
});
