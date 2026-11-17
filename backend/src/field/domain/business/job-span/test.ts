/**
 * REQ-785 — a job of several days (demo-loop dv1-d11; Raphael: "Yes, multi-day jobs."): ONE
 * one-off task with a last day and more workers. Its days, the office's input, who is on it,
 * how far back a worker may act on it, its visit, its services and its invoice line.
 */
import { assert, assertEquals } from "#std/assert";
import {
  covers,
  crewList,
  daysCovered,
  jobDays,
  lastDayOf,
  MAX_JOB_DAYS,
  onTask,
  spanFrom,
} from "./mod.ts";
import {
  canAct,
  inActionWindow,
  officeService,
  oneOffTask,
  sameVisit,
} from "@field/domain/business/tasks/mod.ts";
import {
  batchTitle,
  lineItem,
  linesFor,
  lineText,
} from "@field/domain/business/batch-lines/mod.ts";
import type { FieldTask, FieldWorker } from "@field/dto/field.ts";

let n = 0;
const newId = () => `j${++n}`;
const job = (o: Partial<FieldTask> = {}): FieldTask =>
  oneOffTask(
    {
      userId: "u",
      customerId: "c",
      date: "2026-11-16",
      endDate: "2026-11-18",
      taskTypeId: "fence",
      priceCents: 240000,
      workerId: "luis",
      crewIds: ["pedro"],
      address: "12 Fence Row",
      newId,
      ...o,
    } as Parameters<typeof oneOffTask>[0],
  );
const worker = (id: string, role?: "foreman"): FieldWorker => ({
  id,
  userId: "u",
  name: id,
  phoneNumber: "8435550000",
  pin: "1234",
  role,
  createdAt: "x",
  updatedAt: "x",
});

Deno.test("REQ-785 the days a job covers: first to last, inclusive; a one-day task covers its own day only", () => {
  const t = job();
  assertEquals(lastDayOf(t), "2026-11-18");
  assertEquals(jobDays(t), 3);
  assertEquals(daysCovered(t), ["2026-11-16", "2026-11-17", "2026-11-18"]);
  assertEquals(
    ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"].map(
      (d) => covers(t, d),
    ),
    [false, true, true, true, false],
  );
  const one = { date: "2026-11-16" };
  assertEquals([lastDayOf(one), jobDays(one), daysCovered(one)], [
    "2026-11-16",
    1,
    ["2026-11-16"],
  ]);
  // across a month and a year end
  assertEquals(
    daysCovered({ date: "2026-12-30", endDate: "2027-01-02" }),
    ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"],
  );
  // a stray endDate before the day is ignored, never a backwards span
  assertEquals(
    daysCovered({ date: "2026-11-16", endDate: "2026-11-10" }),
    ["2026-11-16"],
  );
  // a bad record never fans out past the longest job
  assertEquals(
    daysCovered({ date: "2026-01-01", endDate: "2026-12-31" }).length,
    MAX_JOB_DAYS,
  );
});

Deno.test("REQ-785 spanFrom — the last day from endDate or a number of days; the first day itself, null or blank is one day; refusals name a code", () => {
  const d = "2026-11-16";
  assertEquals(spanFrom(d, { endDate: "2026-11-18" }), {
    ok: true,
    endDate: "2026-11-18",
  });
  assertEquals(spanFrom(d, { days: 3 }), { ok: true, endDate: "2026-11-18" });
  assertEquals(spanFrom(d, { days: "3" }), { ok: true, endDate: "2026-11-18" });
  for (
    const one of [{}, { endDate: d }, { endDate: null }, { endDate: "" }, {
      days: 1,
    }]
  ) {
    assertEquals(spanFrom(d, one), { ok: true }, JSON.stringify(one));
  }
  const code = (b: Record<string, unknown>) => {
    const r = spanFrom(d, b);
    return r.ok ? "ok" : r.code;
  };
  assertEquals(
    [
      code({ endDate: "2026-11-15" }),
      code({ endDate: "2026-13-01" }),
      code({ endDate: "nope" }),
      code({ days: 0 }),
      code({ days: 2.5 }),
      code({ days: MAX_JOB_DAYS + 1 }),
      code({ endDate: "2026-12-17" }), // 32 days, Nov 16 → Dec 17
      code({ endDate: "2026-12-16" }), // 31 days
    ],
    [
      "end_before_start",
      "bad_end_date",
      "bad_end_date",
      "bad_days",
      "bad_days",
      "bad_days",
      "job_too_long",
      "ok",
    ],
  );
});

Deno.test("REQ-785 onTask / crewList / canAct — the crew is on the job and may check it off; the crew list is unique and never the lead", () => {
  const t = job();
  assertEquals([onTask("luis", t), onTask("pedro", t), onTask("ana", t)], [
    true,
    true,
    false,
  ]);
  assertEquals(
    [
      canAct(worker("pedro"), t),
      canAct(worker("ana"), t),
      canAct(worker("boss", "foreman"), t),
    ],
    [true, false, true],
  );
  assertEquals(crewList(["pedro", " ana ", "pedro", "luis"], "luis"), [
    "pedro",
    "ana",
  ]);
  assertEquals([crewList(undefined, "luis"), crewList(null, "luis")], [[], []]);
  assertEquals([crewList("pedro", "luis"), crewList([7], "luis")], [
    null,
    null,
  ]);
});

Deno.test("REQ-785 inActionWindow — a job is acted on from its first day until two days after its LAST day (a foreman fourteen); never before it starts", () => {
  const w = worker("luis");
  // a 5-day job that started 4 days ago and ends today
  assertEquals(
    inActionWindow(w, "2026-11-12", "2026-11-16", "2026-11-16"),
    true,
  );
  // its last day was 2 days ago / 3 days ago
  assertEquals(
    [
      inActionWindow(w, "2026-11-08", "2026-11-16", "2026-11-14"),
      inActionWindow(w, "2026-11-08", "2026-11-16", "2026-11-13"),
    ],
    [true, false],
  );
  // it runs on past today: today counts
  assertEquals(
    inActionWindow(w, "2026-11-10", "2026-11-16", "2026-11-20"),
    true,
  );
  // not started yet
  assertEquals(
    inActionWindow(w, "2026-11-17", "2026-11-16", "2026-11-20"),
    false,
  );
  // a one-day task reads as before
  assertEquals(
    [
      inActionWindow(w, "2026-11-14", "2026-11-16"),
      inActionWindow(w, "2026-11-13", "2026-11-16"),
    ],
    [true, false],
  );
  assertEquals(
    inActionWindow(
      worker("b", "foreman"),
      "2026-10-20",
      "2026-11-16",
      "2026-11-02",
    ),
    true,
  );
});

Deno.test("REQ-785 oneOffTask / sameVisit / officeService — the job keeps its last day and crew; a service added to it spans the same days; another job of the customer that starts the same day is another visit", () => {
  const t = job();
  assertEquals([t.oneOff, t.date, t.endDate, t.crewIds], [
    true,
    "2026-11-16",
    "2026-11-18",
    ["pedro"],
  ]);
  const one = job({ endDate: "2026-11-16", crewIds: [] });
  assertEquals(["endDate" in one, "crewIds" in one], [false, false]);
  const added = officeService({
    task: t,
    visit: [t],
    taskTypeId: "haul",
    priceCents: 15000,
    newId,
  });
  assert(added.ok);
  assertEquals(
    [
      added.task.date,
      added.task.endDate,
      added.task.crewIds,
      added.task.oneOff,
    ],
    ["2026-11-16", "2026-11-18", ["pedro"], true],
  );
  assert(sameVisit(t, added.task), "the added service is on the job's visit");
  const shorter = job({ endDate: "2026-11-17", taskTypeId: "gate" });
  assertEquals(sameVisit(t, shorter), false, "a 2-day job is another visit");
  const otherCustomer = job({ customerId: "c2" });
  assertEquals(sameVisit(t, otherCustomer), false);
});

Deno.test("REQ-785 linesFor / lineText / batchTitle — a done job bills ONCE, in any pull that reaches one of its days, its line naming its days", () => {
  const t: FieldTask = { ...job(), status: "complete" };
  const groups = (from: string, to: string) =>
    linesFor({
      from,
      to,
      tasks: [t],
      subscriptions: [],
      taskTypes: [{
        id: "fence",
        userId: "u",
        name: "Fence install",
        createdAt: "x",
      }],
      liveInvoiceIds: new Set(),
    });
  assertEquals(groups("2026-11-18", "2026-11-30").length, 1, "its last day");
  assertEquals(groups("2026-11-01", "2026-11-16").length, 1, "its first day");
  assertEquals(groups("2026-11-19", "2026-11-30").length, 0, "after it");
  const [g] = groups("2026-11-01", "2026-11-30");
  assertEquals(g.lines.length, 1);
  assertEquals(
    lineText(g.lines[0], "en"),
    "Nov 16 – Nov 18 — Fence install — 12 Fence Row",
  );
  assertEquals(
    lineText(g.lines[0], "es"),
    "16 nov – 18 nov — Fence install — 12 Fence Row",
  );
  assertEquals(lineItem(g.lines[0], "en").unit, "job");
  assertEquals(lineItem(g.lines[0], "es").unit, "trabajo");
  assertEquals(batchTitle(g.lines, "en"), {
    jobName: "Fence install",
    serviceDateFrom: "2026-11-16",
    serviceDateTo: "2026-11-18",
  });
});
