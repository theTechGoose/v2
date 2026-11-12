/**
 * REQ-527 — demo issue m55 (demo-loop cycle 3): the worker view said "My tasks",
 * "{done} of {n} services done" and "No visits on this day." for the same list.
 * One noun — tasks / tareas — for the worker view's title, day summary, section
 * heading and empty states.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

/** The keys that name the worker's whole list (title, summary, heading, empty states). */
const LIST_KEYS = [
  "worker.title",
  "worker.today",
  "worker.none",
  "worker.noneCrew",
  "worker.mine",
];

const NOUN = { en: /\btasks?\b/i, es: /\btareas?\b/i };
const OTHER = {
  en: /\b(visits?|services?)\b/i,
  es: /\b(visitas?|servicios?)\b/i,
};

describe("REQ-527 the worker view uses one noun for its list (demo m55, cycle 3)", () => {
  for (const [lang, d] of [["en", en], ["es", es]] as const) {
    for (const key of LIST_KEYS) {
      test(`${lang} ${key} says tasks, never visits/services`, () => {
        const s = d[key];
        expect(s).toBeTruthy();
        expect(s).toMatch(NOUN[lang]);
        expect(s).not.toMatch(OTHER[lang]);
      });
    }
  }

  test("en day summary and empty state read as the demo expects", () => {
    expect(en["worker.today"]).toBe("{done} of {n} tasks done");
    expect(en["worker.none"]).toBe("No tasks this day.");
    expect(es["worker.today"]).toBe("{done} de {n} tareas listas");
    expect(es["worker.none"]).toBe("No tienes tareas este día.");
  });

  test("worker.today keeps its {done} and {n} placeholders in both languages", () => {
    for (const d of [en, es]) {
      expect(d["worker.today"]).toContain("{done}");
      expect(d["worker.today"]).toContain("{n}");
    }
  });
});
