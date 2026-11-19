/**
 * REQ-1167 (LOOP-007 q3, q3-99) — the owner Tasks page in Spanish: the summary row's day header is a
 * standalone day label, so it is capitalised like the worker screen ("Jue 19 de nov", REQ-1065),
 * and its counters are plural labels in front of a number ("Completadas 1 · Pendientes 0"), not the
 * single task's status chip ("Completada").
 */
import * as fs from "fs";
import * as path from "path";
import { fmtDayLabel } from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-1167 (q3-99) owner Tasks page summary in Spanish", () => {
  const page = read("front-end/islands/FieldTasksPage.tsx");
  const en = JSON.parse(read("lang/en.json"));
  const es = JSON.parse(read("lang/es.json"));
  // the summary row: from data-cy="tk-summary" to its closing </div>
  const start = page.indexOf('data-cy="tk-summary"');
  const summary = page.slice(start, page.indexOf("</div>", start));

  test("REQ-1167: fmtDayLabel capitalises the Spanish day ('Jue 19 de nov')", () => {
    expect(fmtDayLabel("2026-11-19", "es")).toBe("Jue 19 de nov");
  });

  test("REQ-1167: the summary row's day header uses fmtDayLabel, not the lowercase fmtDay", () => {
    expect(start).toBeGreaterThan(-1);
    expect(summary).toMatch(/fmtDayLabel\(date, lang\)/);
    expect(summary).not.toMatch(/[^.\w]fmtDay\(date, lang\)/);
  });

  test("REQ-1167: the summary chips use count keys, not the single task's status keys", () => {
    expect(summary).toMatch(/t\("field\.tk\.doneCount"\)/);
    expect(summary).toMatch(/t\("field\.tk\.toDoCount"\)/);
    expect(summary).toMatch(/t\("field\.tk\.skippedCount"\)/);
    expect(summary).not.toMatch(/t\("field\.tk\.done"\)/);
    expect(summary).not.toMatch(/t\("field\.tk\.skipped"\)/);
    // the per-task status chip keeps the singular key
    expect(page).toMatch(/chip--green">\{t\("field\.tk\.done"\)\}/);
  });

  test("REQ-1167: the Spanish count labels are plural; English has them too", () => {
    expect([
      es["field.tk.doneCount"],
      es["field.tk.toDoCount"],
      es["field.tk.skippedCount"],
    ]).toEqual(["Completadas", "Pendientes", "No realizadas"]);
    expect(typeof en["field.tk.doneCount"]).toBe("string");
    expect(typeof en["field.tk.toDoCount"]).toBe("string");
    expect(typeof en["field.tk.skippedCount"]).toBe("string");
    // the single task's status chip stays singular
    expect(es["field.tk.done"]).toBe("Completada");
  });
});
