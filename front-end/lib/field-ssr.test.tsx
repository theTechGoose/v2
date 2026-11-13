/**
 * REQ-730 — demo-loop cycle 5, issue c2-p13-p: "Brief 'Loading…' lines
 * flash". Every /field/* route server-rendered its island with no data, so
 * the first HTML held a "Loading…" text line until the island hydrated and
 * fetched its list (FieldWorkersPage useEffect fetch → "Loading…").
 *
 * - load*Seed() reads the page's first lists on the SSR side with the
 *   caller's session; null when the main list can't be read (the island then
 *   falls back to its client fetch, exactly as before).
 * - Each island seeded with that data renders its rows on its FIRST render,
 *   with no "Loading…" line, so the server HTML already shows them.
 * - Each route loads its seed and hands it to its island.
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import FieldWorkersPage from "../islands/FieldWorkersPage.tsx";
import FieldAssignmentsPage from "../islands/FieldAssignmentsPage.tsx";
import FieldSubscriptionsPage from "../islands/FieldSubscriptionsPage.tsx";
import FieldBatchesPage from "../islands/FieldBatchesPage.tsx";
import FieldTasksPage from "../islands/FieldTasksPage.tsx";
import {
  loadFieldAssignmentsSeed,
  loadFieldBatchesSeed,
  loadFieldSubscriptionsSeed,
  loadFieldTasksSeed,
  loadFieldWorkersSeed,
} from "./field-ssr.ts";
import type {
  BatchView,
  FieldWorker,
  RegionView,
  SubscriptionView,
  TaskView,
} from "../clients/field.ts";
import { todayIso } from "./field.ts";

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));
/** the "Loading…" line in either language (the test env renders Spanish by default) */
const loadingLine = (html: string) =>
  html.includes("Loading…") || html.includes("Cargando…");
const TS = "2026-11-12T10:00:00.000Z";

const worker: FieldWorker = {
  id: "w-730",
  userId: "u-730",
  name: "Ramona Crew",
  phoneNumber: "+15125550730",
  role: "worker",
  language: "es",
  createdAt: TS,
  updatedAt: TS,
};

const sub: SubscriptionView = {
  id: "s-730",
  userId: "u-730",
  customerId: "c-730",
  customerName: "Opal Lawn",
  address: "1 Elm St",
  lat: 30.2,
  lng: -97.7,
  items: [{ taskTypeId: "tt-1", taskTypeName: "Mowing", priceCents: 4000 }],
  cadence: "weekly",
  days: [1],
  active: true,
  regionId: "r-730",
  region: null,
  schedule: { es: "lunes", en: "Mondays" },
  createdAt: TS,
  updatedAt: TS,
};

const region: RegionView = {
  id: "r-730",
  userId: "u-730",
  name: "North Zone",
  color: "#f0a",
  lat: 30.2,
  lng: -97.7,
  workerId: "w-730",
  worker: { id: "w-730", name: "Ramona Crew", role: "worker" },
  subscriptions: [sub],
};

const batch: BatchView = {
  id: "b-730",
  userId: "u-730",
  from: "2026-11-01",
  to: "2026-11-07",
  invoiceIds: ["i-730"],
  invoices: [{
    id: "i-730",
    customerName: "Opal Lawn",
    status: "draft",
    amount: 4000,
    zeroLines: 0,
  }],
  createdAt: TS,
};

const task = (date: string): TaskView => ({
  id: "t-730",
  userId: "u-730",
  subscriptionId: "s-730",
  taskTypeId: "tt-1",
  taskTypeName: "Mowing",
  customerId: "c-730",
  customerName: "Opal Lawn",
  regionId: "r-730",
  regionName: "North Zone",
  workerId: "w-730",
  workerName: "Ramona Crew",
  date,
  priceCents: 4000,
  status: "assigned",
});

type Call = { path: string; sessionId: string | undefined };
type Answer = { ok: boolean; status: number; data?: unknown };

function fakeGet(answers: Record<string, Answer>, calls: Call[] = []) {
  return <T,>(path: string, sessionId: string | undefined) => {
    calls.push({ path, sessionId });
    const a = answers[path] ?? { ok: false, status: 404 };
    return Promise.resolve(a as { ok: boolean; status: number; data?: T });
  };
}
const ok = (data: unknown): Answer => ({ ok: true, status: 200, data });
const down = () => Promise.reject(new Error("backend down"));

Deno.test("REQ-730 (c2-p13-p) loadFieldWorkersSeed reads workers + regions with the caller's session; regions failing → []", async () => {
  const calls: Call[] = [];
  const seed = await loadFieldWorkersSeed(
    "sess-730",
    fakeGet({
      "/field/workers": ok([worker]),
      "/field/regions": ok([region]),
    }, calls),
  );
  assert(seed);
  assertEquals(seed.workers.map((w) => w.id), ["w-730"]);
  assertEquals(seed.regions.map((r) => r.id), ["r-730"]);
  assert(calls.every((c) => c.sessionId === "sess-730"));
  const noZones = await loadFieldWorkersSeed(
    "s",
    fakeGet({ "/field/workers": ok([worker]) }),
  );
  assertEquals(noZones?.regions, []);
  assertEquals(await loadFieldWorkersSeed(undefined, fakeGet({})), null);
  assertEquals(await loadFieldWorkersSeed("s", fakeGet({})), null);
  assertEquals(await loadFieldWorkersSeed("s", down), null);
});

Deno.test("REQ-730 (c2-p13-p) loadFieldAssignmentsSeed needs both regions and workers, else null", async () => {
  const seed = await loadFieldAssignmentsSeed(
    "s",
    fakeGet({
      "/field/workers": ok([worker]),
      "/field/regions": ok([region]),
    }),
  );
  assertEquals(seed?.regions.map((r) => r.id), ["r-730"]);
  assertEquals(seed?.workers.map((w) => w.id), ["w-730"]);
  assertEquals(
    await loadFieldAssignmentsSeed(
      "s",
      fakeGet({ "/field/workers": ok([worker]) }),
    ),
    null,
  );
  assertEquals(await loadFieldAssignmentsSeed(undefined, fakeGet({})), null);
  assertEquals(await loadFieldAssignmentsSeed("s", down), null);
});

Deno.test("REQ-730 (c2-p13-p) loadFieldSubscriptionsSeed / loadFieldBatchesSeed read their list, null when unreadable", async () => {
  const subs = await loadFieldSubscriptionsSeed(
    "s",
    fakeGet({ "/field/subscriptions": ok([sub]) }),
  );
  assertEquals(subs?.subs.map((s) => s.id), ["s-730"]);
  assertEquals(await loadFieldSubscriptionsSeed("s", fakeGet({})), null);
  assertEquals(await loadFieldSubscriptionsSeed(undefined, fakeGet({})), null);
  const b = await loadFieldBatchesSeed(
    "s",
    fakeGet({ "/field/batches": ok([batch]) }),
  );
  assertEquals(b?.batches.map((x) => x.id), ["b-730"]);
  assertEquals(await loadFieldBatchesSeed("s", down), null);
});

Deno.test("REQ-730 (c2-p13-p) loadFieldTasksSeed reads the day's tasks + unstaffed + workers for the given date", async () => {
  const calls: Call[] = [];
  const d = "2026-11-12";
  const seed = await loadFieldTasksSeed(
    "s",
    d,
    fakeGet({
      [`/field/tasks?date=${d}`]: ok([task(d)]),
      [`/field/tasks/unstaffed?date=${d}`]: ok([]),
      "/field/workers": ok([worker]),
    }, calls),
  );
  assert(seed);
  assertEquals(seed.date, d);
  assertEquals(seed.tasks.map((t) => t.id), ["t-730"]);
  assertEquals(seed.skipped, []);
  assertEquals(seed.workers?.map((w) => w.id), ["w-730"]);
  const noSide = await loadFieldTasksSeed(
    "s",
    d,
    fakeGet({ [`/field/tasks?date=${d}`]: ok([task(d)]) }),
  );
  assertEquals(noSide?.skipped, []);
  assertEquals(noSide?.workers, null);
  assertEquals(await loadFieldTasksSeed("s", d, fakeGet({})), null);
  assertEquals(await loadFieldTasksSeed(undefined, d, fakeGet({})), null);
});

Deno.test("REQ-730 (c2-p13-p) FieldWorkersPage seeded renders the worker row on its first render — no Loading… line", () => {
  const html = renderToString(
    <FieldWorkersPage seed={{ workers: [worker], regions: [region] }} />,
  );
  assert(
    html.includes('data-cy="wk-row"'),
    "a worker row is in the first HTML",
  );
  assert(html.includes("Ramona Crew"));
  assert(!loadingLine(html), "no Loading… line");
  assert(
    loadingLine(renderToString(<FieldWorkersPage />)),
    "unseeded still falls back to the client fetch",
  );
});

Deno.test("REQ-730 (c2-p13-p) FieldAssignmentsPage seeded renders the zone on its first render — no Loading… line", () => {
  const html = renderToString(
    <FieldAssignmentsPage seed={{ regions: [region], workers: [worker] }} />,
  );
  assert(html.includes('data-cy="asg-region"'), "a zone is in the first HTML");
  assert(html.includes("North Zone"));
  assert(!loadingLine(html), "no Loading… line");
});

Deno.test("REQ-730 (c2-p13-p) FieldSubscriptionsPage seeded renders the card on its first render — no Loading… line", () => {
  const html = renderToString(
    <FieldSubscriptionsPage seed={{ subs: [sub] }} />,
  );
  assert(html.includes('data-cy="subs-card"'), "a card is in the first HTML");
  assert(html.includes("Opal Lawn"));
  assert(!loadingLine(html), "no Loading… line");
});

Deno.test("REQ-730 (c2-p13-p) FieldBatchesPage seeded renders the past batch on its first render — no Loading… line", () => {
  const html = renderToString(<FieldBatchesPage seed={{ batches: [batch] }} />);
  assert(
    html.includes('data-cy="lt-past"'),
    "a past batch is in the first HTML",
  );
  assert(!loadingLine(html), "no Loading… line");
});

Deno.test("REQ-730 (c2-p13-p) FieldTasksPage seeded for today renders the task on its first render — no Loading… line", () => {
  const d = todayIso();
  const html = renderToString(
    <FieldTasksPage
      seed={{ date: d, tasks: [task(d)], skipped: [], workers: [worker] }}
    />,
  );
  assert(html.includes('data-cy="tk-task"'), "a task is in the first HTML");
  assert(html.includes("Opal Lawn"));
  assert(!loadingLine(html), "no Loading… line");
});

Deno.test("REQ-730 (c2-p13-p) every /field/* list route loads its seed server-side and hands it to the island", () => {
  for (
    const [file, loader, island] of [
      ["workers", "loadFieldWorkersSeed(", "FieldWorkersPage"],
      ["assignments", "loadFieldAssignmentsSeed(", "FieldAssignmentsPage"],
      [
        "subscriptions",
        "loadFieldSubscriptionsSeed(",
        "FieldSubscriptionsPage",
      ],
      ["batches", "loadFieldBatchesSeed(", "FieldBatchesPage"],
      ["tasks", "loadFieldTasksSeed(", "FieldTasksPage"],
    ]
  ) {
    const route = src(`../routes/field/${file}.tsx`);
    assert(route.includes(loader), `${file}: the route calls ${loader}`);
    assert(
      new RegExp(`<${island}\\s+seed=\\{seed\\}`).test(route),
      `${file}: the route passes seed={seed} to ${island}`,
    );
  }
});
