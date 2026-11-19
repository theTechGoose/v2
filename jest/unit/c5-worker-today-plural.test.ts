/**
 * REQ-744 — demo-loop cycle 5, demo issue p18-8a: the worker view's day summary used one
 * plural template, so one task read "1 de 1 tareas listas" / "1 of 1 tasks done" and an empty
 * day read "0 de 0 tareas listas". The summary now picks its key by the task count: a
 * singular form for one task and "Sin tareas hoy" / "No tasks today" for none.
 */
import * as fs from "fs";
import * as path from "path";
import { workerTodayKey } from "../../front-end/lib/worker-today";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dicts = {
  en: JSON.parse(read("lang/en.json")) as Record<string, string>,
  es: JSON.parse(read("lang/es.json")) as Record<string, string>,
};

/** what the island renders: the picked key, filled like lib/i18n's t().
 *  REQ-1005 (LOOP-007 q1-91): the island tells the picker whether the shown day is today. */
const pick = workerTodayKey as (n: number, isToday?: boolean) => string;
const line = (lang: "en" | "es", done: number, n: number, isToday = true) => {
  const s = dicts[lang][pick(n, isToday)];
  expect(s).toBeTruthy();
  return s.replace(
    /\{(\w+)\}/g,
    (_, k) => String(({ done, n } as Record<string, number>)[k]),
  );
};

describe("REQ-744 worker day summary agrees with its count (demo p18-8a, cycle 5)", () => {
  test("es: one task is singular", () => {
    expect(line("es", 1, 1)).toBe("1 de 1 tarea lista");
    expect(line("es", 0, 1)).toBe("0 de 1 tarea lista");
  });
  test("en: one task is singular", () => {
    expect(line("en", 1, 1)).toBe("1 of 1 task done");
  });
  test("several tasks keep the plural", () => {
    expect(line("es", 2, 3)).toBe("2 de 3 tareas listas");
    expect(line("en", 2, 3)).toBe("2 of 3 tasks done");
  });
  test("no tasks: no '0 de 0' line", () => {
    expect(line("es", 0, 0)).toBe("Sin tareas hoy");
    expect(line("en", 0, 0)).toBe("No tasks today");
  });
  test("en and es carry the same worker.today keys", () => {
    const keys = (d: Record<string, string>) =>
      Object.keys(d).filter((k) =>
        k.startsWith("worker.today") && k !== "worker.todayLink"
      ).sort();
    expect(keys(dicts.es)).toEqual(keys(dicts.en));
  });
  test("WorkerScreen picks the key by the task count and whether the shown day is today (REQ-1005)", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    expect(src).toMatch(
      /t\(workerTodayKey\(liveTasks\.length,\s*date === today\)/,
    );
    expect(src).not.toMatch(/t\("worker\.today",/);
  });
});

describe("REQ-1005 (LOOP-007 q1, q1-91) an empty day that is not today never says 'today'", () => {
  test("not today, no tasks: the day-neutral key", () => {
    expect(pick(0, false)).toBe("worker.day.none");
  });
  test("today, no tasks: still 'No tasks today' / 'Sin tareas hoy'", () => {
    expect(pick(0, true)).toBe("worker.today.none");
    expect(line("en", 0, 0, true)).toBe("No tasks today");
    expect(line("es", 0, 0, true)).toBe("Sin tareas hoy");
  });
  test("en/es copy for an empty other day has no 'today' / 'hoy'", () => {
    const en = line("en", 0, 0, false);
    const es = line("es", 0, 0, false);
    expect(en).toBe("No tasks this day");
    expect(en.toLowerCase()).not.toContain("today");
    expect(es).toBe("Sin tareas este día");
    expect(es.toLowerCase()).not.toContain("hoy");
  });
  test("counts on other days keep their singular / plural forms", () => {
    expect(line("en", 0, 1, false)).toBe("0 of 1 task done");
    expect(line("es", 1, 3, false)).toBe("1 de 3 tareas listas");
  });
  test("en and es both carry worker.day.none", () => {
    expect(dicts.en["worker.day.none"]).toBeTruthy();
    expect(dicts.es["worker.day.none"]).toBeTruthy();
  });
});
