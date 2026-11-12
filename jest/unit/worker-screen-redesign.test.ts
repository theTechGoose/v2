/**
 * REQ-196 — the worker's screen redesigned: the day in one glance (a progress ring and a
 * sentence), a sliding thumb under the chosen tab and day, visit cards with a state chip, a
 * check-off that pops, lists that rise in and replay on a day change, a proper empty state.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-196 the worker's screen", () => {
  const screen = read("front-end/islands/WorkerScreen.tsx");
  test("the summary: a ring that is the progressbar, the count, and what is left", () => {
    expect(screen).toMatch(/data-cy="w-summary"/);
    expect(screen).toMatch(
      /class="ring"\s+data-cy="w-progress"\s+role="progressbar"/,
    );
    expect(screen).toMatch(/style=\{`--p:\$\{pct\}`\}/);
    expect(screen).toMatch(/pathLength=\{100\}/);
    expect(screen).toMatch(
      /t\("worker\.left", \{ n: liveTasks\.length - done \}\)/,
    );
    expect(screen).toMatch(
      /\.ring__bar \{[^}]*stroke-dasharray: var\(--p, 0\) 100;[^}]*transition: stroke-dasharray/,
    );
  });
  test("thumbs slide under the chosen tab and day", () => {
    expect(screen).toMatch(/data-tab=\{tab\}/);
    expect(screen).toMatch(/class="tabs__thumb"/);
    expect(screen).toMatch(
      /\.tabs\[data-tab="clock"\] \.tabs__thumb \{ transform: translateX/,
    );
    expect(screen).toMatch(/class="days__thumb"/);
    expect(screen).toMatch(
      /\.days\[data-sel="next"\] \.days__thumb \{ transform: translateX\(calc\(200% \+ 12px\)\)/,
    );
  });
  test("cards: a state chip, a popping check, lists that stagger and replay per day, an empty state", () => {
    expect(screen).toMatch(/data-cy="w-visit-state"/);
    expect(screen).toMatch(
      /\.svc--done \.svc__check svg \{[^}]*animation: pop/,
    );
    expect(screen).toMatch(/<div class="tasks" data-stagger key=\{date\}>/);
    expect(screen).toMatch(/data-cy="w-empty"/);
    expect(screen).toMatch(/<div class="wrap" data-stagger>/);
    expect(screen).toMatch(/data-cy="w-pane-clock" data-pane/);
    expect(screen).not.toMatch(/class="panel hint"/);
    // a stable order: in-progress visits first A→Z, finished ones sink
    expect(screen).toMatch(
      /finished\(a\) - finished\(b\) \|\| a\.customerName\.localeCompare\(b\.customerName\)/,
    );
    expect(screen).toMatch(
      /\.visit__btns button \{[^}]*flex-direction: column/,
    );
  });
  test("both dictionaries carry the new strings", () => {
    const en = JSON.parse(read("lang/en.json")),
      es = JSON.parse(read("lang/es.json"));
    expect([en["worker.left"], en["worker.freeDay"], en["worker.visitDone"]])
      .toEqual(["{n} to go", "Nothing scheduled.", "Done"]);
    expect([es["worker.left"], es["worker.freeDay"], es["worker.visitDone"]])
      .toEqual(["{n} por hacer", "Nada programado.", "Listo"]);
  });
});
