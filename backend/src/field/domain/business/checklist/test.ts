/** REQ-811 — a checklist a repeat visit references instead of listing the same services again. */
import { assertEquals } from "#std/assert";
import {
  checklistNameTaken,
  checklistUsage,
  effectiveItems,
  withChecklist,
} from "./mod.ts";
import { generateTasks } from "@field/domain/business/tasks/mod.ts";
import type { Checklist, Region, Subscription } from "@field/dto/field.ts";

const ckl: Checklist = {
  id: "c1",
  userId: "u",
  name: "Full yard",
  items: [{ taskTypeId: "mow", priceCents: 6500 }, {
    taskTypeId: "edge",
    priceCents: 2500,
  }],
  createdAt: "x",
  updatedAt: "x",
};
const visit: Subscription = {
  id: "s1",
  userId: "u",
  customerId: "cu",
  address: "a",
  lat: 0,
  lng: 0,
  items: [],
  cadence: "weekly",
  startDate: "2026-11-10",
  days: [0, 1, 2, 3, 4, 5, 6],
  intervalWeeks: 1,
  active: true,
  regionId: "r1",
  createdAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
};
const regions: Region[] = [{
  id: "r1",
  userId: "u",
  name: "Z1",
  color: "#000",
  lat: 0,
  lng: 0,
  workerId: "w1",
}];
const find = (id: string) => (id === ckl.id ? ckl : null);

Deno.test("REQ-811 effectiveItems — no checklist: the visit's own items, as they are", () => {
  const own = [{ taskTypeId: "blow", priceCents: 1500 }];
  assertEquals(effectiveItems({ items: own }, null), own);
  assertEquals(effectiveItems({ items: own, checklistId: "gone" }, null), own);
});

Deno.test("REQ-811 effectiveItems — the checklist's items come first, then the visit's own extras", () => {
  const items = effectiveItems({
    items: [{ taskTypeId: "blow", priceCents: 1500 }],
    checklistId: "c1",
  }, ckl);
  assertEquals(items, [
    { taskTypeId: "mow", priceCents: 6500 },
    { taskTypeId: "edge", priceCents: 2500 },
    { taskTypeId: "blow", priceCents: 1500 },
  ]);
});

Deno.test("REQ-811 effectiveItems — a type in both is listed once, at the visit's OWN price", () => {
  const items = effectiveItems({
    items: [{ taskTypeId: "edge", priceCents: 3000 }],
    checklistId: "c1",
  }, ckl);
  assertEquals(items, [{ taskTypeId: "mow", priceCents: 6500 }, {
    taskTypeId: "edge",
    priceCents: 3000,
  }]);
});

Deno.test("REQ-811 withChecklist — a copy carrying the effective items, nothing else changed; no checklist → the same record", () => {
  const s = {
    ...visit,
    checklistId: "c1",
    items: [{ taskTypeId: "blow", priceCents: 1500 }],
  };
  const out = withChecklist(s, find);
  assertEquals(out.items.map((i) => i.taskTypeId), ["mow", "edge", "blow"]);
  assertEquals(s.items.length, 1, "the stored record keeps only its own items");
  assertEquals({ ...out, items: s.items }, s);
  assertEquals(withChecklist(visit, find), visit);
  assertEquals(withChecklist({ ...visit, checklistId: "gone" }, find), {
    ...visit,
    checklistId: "gone",
  });
});

Deno.test("REQ-811 generateTasks on a checklist visit — one task per checklist service at the checklist's price, the override at the visit's", () => {
  let n = 0;
  const s = withChecklist({
    ...visit,
    checklistId: "c1",
    items: [{ taskTypeId: "edge", priceCents: 3000 }],
  }, find);
  const tasks = generateTasks({
    userId: "u",
    date: "2026-11-17",
    subscriptions: [s],
    regions,
    existing: [],
    newId: () => `t${++n}`,
  });
  assertEquals(tasks.map((t) => [t.taskTypeId, t.priceCents, t.workerId]), [[
    "mow",
    6500,
    "w1",
  ], ["edge", 3000, "w1"]]);
  // a plain visit with no items and no checklist makes nothing
  assertEquals(
    generateTasks({
      userId: "u",
      date: "2026-11-17",
      subscriptions: [visit],
      regions,
      existing: [],
      newId: () => "x",
    }),
    [],
  );
});

Deno.test("REQ-811 checklistNameTaken — case- and accent-insensitive; the record itself is not a clash", () => {
  const all: Checklist[] = [ckl, { ...ckl, id: "c2", name: "Jardín completo" }];
  assertEquals(checklistNameTaken(all, "full YARD"), true);
  assertEquals(checklistNameTaken(all, "  jardin completo "), true);
  assertEquals(checklistNameTaken(all, "Full yard", "c1"), false);
  assertEquals(checklistNameTaken(all, "Spring cleanup"), false);
});

Deno.test("REQ-811 checklistUsage — how many repeat visits reference it", () => {
  const subs = [visit, { ...visit, id: "s2", checklistId: "c1" }, {
    ...visit,
    id: "s3",
    checklistId: "c1",
  }, { ...visit, id: "s4", checklistId: "c9" }];
  assertEquals(checklistUsage(subs, "c1"), 2);
  assertEquals(checklistUsage(subs, "c2"), 0);
});
