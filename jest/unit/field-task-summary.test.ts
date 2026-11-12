/**
 * REQ-284 — demo issue customers-payments-fieldops-m4: once the day's only task was done, the
 * summary on /field/tasks read "COMPLETE 1 · ASSIGNED 0", as if nobody were on the task. The
 * second chip counted the tasks not yet done but wore the per-task status label "Assigned"
 * (field.tk.assigned, TaskStatus "assigned" = not done yet). The summary's counts live in
 * front-end/lib/field-task-summary.ts and the chip wears its own counter label, "To do".
 */
import * as fs from "fs";
import * as path from "path";
import { daySummary } from "../../front-end/lib/field-task-summary";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const island = read("front-end/islands/FieldTasksPage.tsx");

describe("REQ-284 daySummary — the day's counts", () => {
  test("one task, done: 1 complete, 0 to do, 1 counted", () => {
    expect(daySummary([{ status: "complete" }])).toEqual({
      done: 1,
      toDo: 0,
      notDone: 0,
      counted: 1,
    });
  });

  test("open tasks are to do; skipped and deferred are neither done nor to do", () => {
    expect(
      daySummary([
        { status: "assigned" },
        { status: "assigned" },
        { status: "complete" },
        { status: "skipped" },
        { status: "deferred" },
      ]),
    ).toEqual({ done: 1, toDo: 2, notDone: 2, counted: 3 });
  });

  test("an empty day is all zeros", () => {
    expect(daySummary([])).toEqual({
      done: 0,
      toDo: 0,
      notDone: 0,
      counted: 0,
    });
  });
});

describe("REQ-284 the summary chip says 'To do', not the status 'Assigned'", () => {
  const summary = island.slice(island.indexOf('data-cy="tk-summary"'));
  const chips = summary.slice(0, summary.indexOf("</div>"));

  test("the summary row uses field.tk.toDo and never field.tk.assigned", () => {
    expect(chips).toContain('t("field.tk.toDo")');
    expect(chips).not.toContain("field.tk.assigned");
  });

  test("the island counts with daySummary", () => {
    expect(island).toMatch(
      /import \{ daySummary \} from "\.\.\/lib\/field-task-summary\.ts";/,
    );
    expect(island).toContain("daySummary(tasks)");
  });

  test("both languages carry the counter label; the status label stays", () => {
    expect(en["field.tk.toDo"]).toBe("To do");
    expect(es["field.tk.toDo"]).toBe("Pendientes");
    expect(en["field.tk.assigned"]).toBe("Assigned");
    expect(es["field.tk.assigned"]).toBe("Asignada");
  });
});
