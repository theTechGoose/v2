/**
 * REQ-1012 (LOOP-007 cycle 1, q1-98) — Raphael: "test every single aspect of this application …
 * one Opus agent per issue to do root cause analysis, then one to write the test, then one to fix
 * it and make it green."
 *
 * The /field/workers header subtitle (`field.wk.sub`, drawn by FieldWorkersPage's FieldHead) says
 * a worker "sees only today's tasks" (es: "ve solo sus tareas del día"). The string predates
 * REQ-194 (Yesterday / Today / Tomorrow on the worker's Tasks tab), REQ-362 (tomorrow is a
 * read-only preview) and REQ-528 (a date input for any day). The worker view (WorkerScreen) shows
 * all of those, so the header contradicts it.
 *
 * This pins the copy against the real dictionaries AND the real worker view's source, so the two
 * stay in step.
 */
import * as fs from "fs";
import * as path from "path";
import en from "../../lang/en.json";
import es from "../../lang/es.json";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

describe("REQ-1012 /field/workers header matches what the worker view does", () => {
  test("REQ-1012: the header subtitle is field.wk.sub and the worker view really has Yesterday/Today/Tomorrow + any date", () => {
    expect(read("front-end/islands/FieldWorkersPage.tsx")).toContain(
      'sub={t("field.wk.sub")}',
    );
    const ws = read("front-end/islands/WorkerScreen.tsx");
    expect(ws).toContain("[-1, 0, 1]");
    expect(ws).toContain('"worker.yesterday"');
    expect(ws).toContain('"worker.tomorrow"');
    expect(ws).toMatch(/type="date"[\s\S]{0,120}data-cy="w-day-pick"/);
  });

  test("REQ-1012: en field.wk.sub no longer claims the worker sees only today's tasks", () => {
    const s = EN["field.wk.sub"];
    expect(s).toBeDefined();
    expect(s).not.toMatch(/only today/i);
    expect(s).not.toMatch(/today's tasks/i);
  });

  test("REQ-1012: es field.wk.sub no longer claims the worker sees only the day's tasks", () => {
    const s = ES["field.wk.sub"];
    expect(s).toBeDefined();
    expect(s).not.toMatch(/solo sus tareas del día/i);
    expect(s).not.toMatch(/\bsolo\b[^.]*\bdel día\b/i);
  });

  test("REQ-1012: the subtitle describes the day range the worker view offers (yesterday / tomorrow / any date)", () => {
    const e = EN["field.wk.sub"].toLowerCase();
    expect(e).toContain("yesterday");
    expect(e).toContain("tomorrow");
    const s = ES["field.wk.sub"].toLowerCase();
    expect(s).toContain("ayer");
    expect(s).toContain("mañana");
  });

  test("REQ-1012: the two true claims stay — own PIN, never prices or invoices", () => {
    const e = EN["field.wk.sub"];
    expect(e).toMatch(/PIN/);
    expect(e).toMatch(/never sees prices or invoices/i);
    const s = ES["field.wk.sub"];
    expect(s).toMatch(/PIN/);
    expect(s).toMatch(/nunca ve precios ni facturas/i);
  });
});
