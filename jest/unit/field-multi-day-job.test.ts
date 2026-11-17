/**
 * REQ-785 — demo-loop cycle dv1, issue d11 (first seen cycle 3, M42): "A job that runs several
 * days can be scheduled as one job". Raphael: "Yes, multi-day jobs."
 *
 * /field/tasks: "Add task" takes a last day and more workers. A job of several days is ONE card on
 * each of its days ("Day 2 of 3 · Nov 16 – Nov 18"), "Edit dates" changes its days, and one check
 * marks it done. /worker shows it on each of its days, to the lead and the crew, as its own visit.
 * The pure rules live in front-end/lib/field-job.ts.
 */
import * as fs from "fs";
import * as path from "path";
import {
  crewChoices,
  endDateToSend,
  jobDayOf,
  jobDays,
  jobRange,
  jobSpanProblem,
  lastDay,
  MAX_JOB_DAYS,
  onJob,
  visitKey,
  workMates,
} from "../../front-end/lib/field-job";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const tasksIsland = read("front-end/islands/FieldTasksPage.tsx");
const workerIsland = read("front-end/islands/WorkerScreen.tsx");
const client = read("front-end/clients/field.ts");

const job = {
  id: "j",
  subscriptionId: "",
  customerId: "c1",
  date: "2026-11-16",
  endDate: "2026-11-18",
  workerId: "luis",
  workerName: "Luis",
  crewIds: ["pedro", "ana"],
  crewNames: ["Pedro", "Ana"],
};

describe("REQ-785 the job's days", () => {
  test("REQ-785 a 3-day job: its last day, its length, which day of it a date is", () => {
    expect(lastDay(job)).toBe("2026-11-18");
    expect(jobDays(job)).toBe(3);
    expect(
      ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]
        .map((d) => jobDayOf(job, d)),
    ).toEqual([null, { n: 1, of: 3 }, { n: 2, of: 3 }, { n: 3, of: 3 }, null]);
  });

  test("REQ-785 a one-day task is not a job of several days", () => {
    const one = { date: "2026-11-16" };
    expect([lastDay(one), jobDays(one), jobDayOf(one, "2026-11-16")]).toEqual(
      ["2026-11-16", 1, null],
    );
    expect(jobDays({ date: "2026-11-16", endDate: "2026-11-10" })).toBe(1);
  });

  test("REQ-785 the range reads short in each language, across a month end too", () => {
    expect(jobRange(job, "en")).toBe("Nov 16 – Nov 18");
    expect(jobRange(job, "es")).toMatch(/^16 nov\.? – 18 nov\.?$/);
    expect(jobRange({ date: "2026-11-30", endDate: "2026-12-02" }, "en")).toBe(
      "Nov 30 – Dec 2",
    );
  });

  test("REQ-785 the form's last day: blank or the first day is one day; before the first, or past 31 days, is a problem", () => {
    expect(endDateToSend("2026-11-16", "")).toBeUndefined();
    expect(endDateToSend("2026-11-16", "2026-11-16")).toBeUndefined();
    expect(endDateToSend("2026-11-16", "2026-11-18")).toBe("2026-11-18");
    expect(jobSpanProblem("2026-11-16", "")).toBeNull();
    expect(jobSpanProblem("2026-11-16", "2026-11-18")).toBeNull();
    expect(jobSpanProblem("2026-11-16", "2026-11-15")).toEqual({
      key: "field.tk.badEnd",
    });
    expect(MAX_JOB_DAYS).toBe(31);
    expect(jobSpanProblem("2026-11-16", "2026-12-16")).toBeNull(); // 31 days
    expect(jobSpanProblem("2026-11-16", "2026-12-17")).toEqual({
      key: "field.tk.jobTooLong",
      vars: { max: "31" },
    });
  });
});

describe("REQ-785 who is on the job", () => {
  test("REQ-785 the lead and the crew are on it; anyone else is not", () => {
    expect([onJob("luis", job), onJob("pedro", job), onJob("sam", job)])
      .toEqual([true, true, false]);
    expect(onJob("luis", { workerId: "luis" })).toBe(true);
  });

  test("REQ-785 a worker sees who else is on the job, never themself", () => {
    expect(workMates(job, "pedro")).toEqual(["Luis", "Ana"]);
    expect(workMates(job, "luis")).toEqual(["Pedro", "Ana"]);
    expect(workMates({ workerId: "luis", workerName: "Luis" }, "luis"))
      .toEqual([]);
  });

  test("REQ-785 the crew is picked from every worker but the lead", () => {
    const ws = [{ id: "luis" }, { id: "pedro" }, { id: "ana" }];
    expect(crewChoices(ws, "luis").map((w) => w.id)).toEqual(["pedro", "ana"]);
    expect(crewChoices(ws, "").map((w) => w.id)).toEqual([
      "luis",
      "pedro",
      "ana",
    ]);
  });

  test("REQ-785 /worker's visit: a subscription's day; a one-off's customer and days — a 3-day job never merges with another customer's one-off", () => {
    expect(visitKey({ ...job, subscriptionId: "s1" })).toBe("s1");
    expect(visitKey(job)).toBe("job:c1|2026-11-16|2026-11-18");
    expect(visitKey({ ...job, customerId: "c2", endDate: undefined })).toBe(
      "job:c2|2026-11-16|2026-11-16",
    );
    expect(visitKey(job)).not.toBe(visitKey({ ...job, customerId: "c2" }));
  });
});

describe("REQ-785 the words, en + es", () => {
  const keys: [string, string[]][] = [
    ["field.tk.firstDay", []],
    ["field.tk.lastDay", []],
    ["field.tk.lastDayHint", []],
    ["field.tk.spanDays", ["{n}", "{range}"]],
    ["field.tk.jobDay", ["{n}", "{total}"]],
    ["field.tk.crew", []],
    ["field.tk.crewLine", ["{names}"]],
    ["field.tk.editDates", []],
    ["field.tk.datesTitle", []],
    ["field.tk.datesSaved", ["{range}"]],
    ["field.tk.badEnd", []],
    ["field.tk.jobTooLong", ["{max}"]],
    ["field.tk.deleteJobAsk", ["{n}"]],
    ["worker.jobDay", ["{n}", "{total}", "{range}"]],
    ["worker.crewWith", ["{names}"]],
  ];
  test.each(keys)(
    "REQ-785 %s is in both dictionaries with its placeholders",
    (key, vars) => {
      for (const dict of [en, es]) {
        expect(typeof dict[key]).toBe("string");
        expect(dict[key].trim()).not.toBe("");
        for (const v of vars) expect(dict[key]).toContain(v);
      }
      expect(es[key]).not.toBe(en[key]);
    },
  );

  test("REQ-785 the add form's hint says a job can run several days", () => {
    expect(en["field.tk.addHint"]).toMatch(/several days/i);
    expect(es["field.tk.addHint"]).toMatch(/varios días/i);
  });
});

describe("REQ-785 the pages are wired to it", () => {
  test("REQ-785 the client sends and reads a job's last day and crew", () => {
    expect(client).toMatch(
      /interface OneOffTaskInput[\s\S]*?endDate\?: string;[\s\S]*?crewIds\?: string\[\];/,
    );
    expect(client).toMatch(
      /interface TaskView[\s\S]*?endDate\?: string;[\s\S]*?crewNames\?: string\[\];/,
    );
    expect(client).toMatch(
      /interface WorkerTaskView[\s\S]*?endDate\?: string;[\s\S]*?crewNames\?: string\[\];/,
    );
    const update = client.slice(client.indexOf("updateTask:"));
    expect(update.slice(0, update.indexOf("=>"))).toMatch(
      /endDate\?: string \| null;/,
    );
  });

  test("REQ-785 Add task: a last day and more workers go out with the task", () => {
    expect(tasksIsland).toMatch(/data-cy="tk-add-end"/);
    // the crew picker renders data-cy={cy}
    expect(tasksIsland).toMatch(/<CrewPicks\s+cy="tk-add-crew"/);
    expect(tasksIsland).toMatch(/data-cy=\{cy\}/);
    const submit = tasksIsland.slice(
      tasksIsland.indexOf("async function submitAdd"),
      tasksIsland.indexOf("async function createCustomer"),
    );
    expect(submit).toMatch(/jobSpanProblem\(add\.date, add\.endDate\)/);
    expect(submit).toMatch(/endDate: endDateToSend\(add\.date, add\.endDate\)/);
    expect(submit).toMatch(/crewIds: add\.crewIds/);
  });

  test("REQ-785 the card names the job's day and crew, edits its dates, and asks before deleting all its days", () => {
    expect(tasksIsland).toMatch(/data-cy="tk-span"/);
    expect(tasksIsland).toMatch(/jobDayOf\(x, date\)/);
    expect(tasksIsland).toMatch(/data-cy="tk-crew"/);
    expect(tasksIsland).toMatch(/data-cy="tk-edit-dates"/);
    expect(tasksIsland).toMatch(/data-cy="tk-dates-form"/);
    const dates = tasksIsland.slice(
      tasksIsland.indexOf("async function saveDates"),
    );
    expect(dates.slice(0, dates.indexOf("\n  }\n"))).toMatch(
      /fieldClient\.updateTask\([\s\S]*?date: [\s\S]*?endDate: [\s\S]*?crewIds: /,
    );
    expect(tasksIsland).toMatch(/field\.tk\.deleteJobAsk/);
  });

  test("REQ-785 /worker: its visits key on visitKey, its list takes the crew's jobs, a job shows its day, and a job of several days is never deferred", () => {
    expect(workerIsland).toMatch(/visitKey\(x\)/);
    expect(workerIsland).toMatch(/onJob\(me\.id, x\)/);
    expect(workerIsland).toMatch(/data-cy="w-job-span"/);
    expect(workerIsland).toMatch(/data-cy="w-crew"/);
    expect(workerIsland).not.toMatch(
      /tasks\.filter\(\(x\) => x\.workerId === me\.id\)/,
    );
  });
});
