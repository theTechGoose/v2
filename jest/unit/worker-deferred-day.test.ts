/**
 * REQ-1011 — LOOP-007 cycle 1, QA issue q1-97: on /worker (ES) a deferred visit contradicted
 * itself and its date was raw.
 *  (1) the "aplazada de {date}" label (worker) and the office's field.tk.deferredFrom chip were
 *      fed `deferredFrom.slice(5)` → "aplazada de 11-18" instead of the localized fmtDay
 *      ("mié, 18 nov");
 *  (2) on the deferred day the summary counts only live tasks (deferred excluded) and says
 *      "Sin tareas hoy · Nada programado.", while the body still draws the visit card with a
 *      "0/0" chip — the very "0 of 0" REQ-744 removed.
 */
import * as fs from "fs";
import * as path from "path";
import { fmtDay } from "../../front-end/lib/field";
import * as workerToday from "../../front-end/lib/worker-today";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

type Row = { id: string; status: string };
type DayCounts = { live: number; deferred: number };

describe("REQ-1011 (LOOP-007 q1-97) the deferred visit: localized date, one story per day", () => {
  test("REQ-1011: fmtDay gives the localized short day the label should carry", () => {
    const s = fmtDay("2026-11-18", "es");
    expect(s).toContain("18");
    expect(s).toContain("nov");
    expect(s).not.toContain("11-18");
  });

  test("REQ-1011: the worker's 'aplazada de {date}' label is formatted with fmtDay, not sliced", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    const m = src.match(
      /t\("worker\.fromYesterday",\s*\{\s*date:\s*([^}]*?)\s*,?\s*\}\)/,
    );
    expect(m).not.toBeNull();
    const expr = m![1];
    expect(expr).not.toMatch(/\.slice\(/);
    expect(expr).toMatch(/fmtDay\(\s*s\.deferredFrom\s*,\s*lang\s*\)/);
    // what the ES worker reads for a task deferred from 2026-11-18
    const shown = es["worker.fromYesterday"].replace(
      "{date}",
      fmtDay("2026-11-18", "es"),
    );
    expect(shown).not.toContain("11-18");
  });

  test("REQ-1011: the office's field.tk.deferredFrom chip is formatted with fmtDay, not sliced", () => {
    const src = read("front-end/islands/FieldTasksPage.tsx");
    const m = src.match(
      /t\("field\.tk\.deferredFrom",\s*\{\s*date:\s*([^}]*?)\s*,?\s*\}\)/,
    );
    expect(m).not.toBeNull();
    const expr = m![1];
    expect(expr).not.toMatch(/\.slice\(/);
    expect(expr).toMatch(/fmtDay\(\s*x\.deferredFrom\s*,\s*lang\s*\)/);
  });

  test("REQ-1011: workerDayCounts splits a day into live and deferred tasks (one deferred → 0 live / 1 deferred)", () => {
    const fn = (workerToday as Record<string, unknown>).workerDayCounts as
      | ((rows: Row[]) => DayCounts)
      | undefined;
    expect(typeof fn).toBe("function");
    expect(fn!([{ id: "a", status: "deferred" }])).toEqual({
      live: 0,
      deferred: 1,
    });
    expect(
      fn!([
        { id: "a", status: "assigned" },
        { id: "b", status: "complete" },
        { id: "c", status: "deferred" },
        { id: "d", status: "skipped" },
      ]).live,
    ).toBe(2);
  });

  test("REQ-1011: the visit chip never renders '0/0' — a visit with no live services gets no count", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    // today's chip: `all ? visitDone : `${done}/${act_.length}`` → "0/0" when every service is deferred
    expect(
      /\{\s*all\s*\?\s*t\("worker\.visitDone"\)\s*:\s*`\$\{done\}\/\$\{act_\.length\}`\s*\}/
        .test(src),
    ).toBe(false);
  });

  test("REQ-1011: the worker body and the summary agree — the body does not pick cards from the unfiltered `mine.length`", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    // the summary says "Sin tareas hoy · Nada programado." from liveTasks; the body chose cards
    // from every row incl. deferred ones, so a deferred-only day showed both
    expect(/body = mine\.length\s*\?/.test(src)).toBe(false);
    // renderSection (foreman) had the same split: liveRows for the count, rows.length for the body
    expect(/\{rows\.length\s*\?\s*\(\s*<div class="tasks"/.test(src)).toBe(
      false,
    );
  });

  test("REQ-1163 (q3-96): a work order flagged `out` (the worker is off, the office reschedules) draws its card but is not on the to-do count", () => {
    const counts = workerToday.workerDayCounts([{ status: "assigned", out: "skip" }, { status: "assigned" }]);
    expect(counts).toEqual({ live: 1, deferred: 1 });
  });
});
