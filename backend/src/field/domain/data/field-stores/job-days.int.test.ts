/**
 * REQ-785 — a multi-day job (demo-loop dv1-d11) is ONE task record keyed under each day it
 * covers. On the in-memory KV: a day read lists it once on each of its days; a re-put with other
 * days drops the day keys it left; many long jobs in one putMany stay under KV's 1000-mutation cap.
 */
import { assertEquals } from "#std/assert";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { FieldTaskStore } from "./mod.ts";
import type { FieldTask } from "@field/dto/field.ts";

const task = (id: string, date: string, endDate?: string): FieldTask => ({
  id,
  userId: "u785",
  subscriptionId: "",
  oneOff: true,
  taskTypeId: "fence",
  customerId: "c",
  regionId: "",
  workerId: "w",
  date,
  ...(endDate ? { endDate } : {}),
  priceCents: 100,
  status: "assigned",
});

async function withKv(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    await fn();
  } finally {
    await resetKv();
  }
}

/** the days a task id is keyed under, straight from the index */
async function keyedDays(id: string): Promise<string[]> {
  const kv = await getKv();
  const days: string[] = [];
  for await (
    const e of kv.list<string>({ prefix: ["field_task_by_day", "u785"] })
  ) {
    if (e.value === id) days.push(String(e.key[2]));
  }
  return days;
}

Deno.test("REQ-785 FieldTaskStore — a 3-day job lists once on each of its days and nowhere else; a range read answers it once", async () => {
  await withKv(async () => {
    const store = new FieldTaskStore();
    await store.put(task("job", "2026-11-16", "2026-11-18"));
    await store.put(task("one", "2026-11-17"));
    const day = async (d: string) =>
      (await store.listByDay("u785", d)).map((t) => t.id).sort();
    assertEquals(await day("2026-11-15"), []);
    assertEquals(await day("2026-11-16"), ["job"]);
    assertEquals(await day("2026-11-17"), ["job", "one"]);
    assertEquals(await day("2026-11-18"), ["job"]);
    assertEquals(await day("2026-11-19"), []);
    const range = await store.listByRange("u785", "2026-11-01", "2026-11-30");
    assertEquals(range.map((t) => t.id).sort(), ["job", "one"], "once each");
  });
});

Deno.test("REQ-785 FieldTaskStore — new days drop the day keys the job left; delete drops them all", async () => {
  await withKv(async () => {
    const store = new FieldTaskStore();
    await store.put(task("job", "2026-11-16", "2026-11-18"));
    await store.put(task("job", "2026-11-17", "2026-11-19"));
    assertEquals(await keyedDays("job"), [
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
    ]);
    await store.putMany([task("job", "2026-11-20")]);
    assertEquals(await keyedDays("job"), ["2026-11-20"]);
    assertEquals(
      (await store.listByDay("u785", "2026-11-18")).length,
      0,
      "gone from the day it left",
    );
    await store.put(task("job", "2026-11-20", "2026-11-22"));
    await store.delete(await store.get("job"));
    assertEquals(await keyedDays("job"), []);
  });
});

Deno.test("REQ-785 FieldTaskStore — 40 jobs of 31 days in one putMany (1,320 writes) commit under the KV cap and all list", async () => {
  await withKv(async () => {
    const store = new FieldTaskStore();
    const jobs = Array.from(
      { length: 40 },
      (_, i) => task(`long${i}`, "2026-12-01", "2026-12-31"),
    );
    await store.putMany(jobs);
    assertEquals((await store.listByDay("u785", "2026-12-15")).length, 40);
    assertEquals((await store.listByDay("u785", "2026-12-31")).length, 40);
  });
});
