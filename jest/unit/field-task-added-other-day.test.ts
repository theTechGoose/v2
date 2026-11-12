/**
 * REQ-526 — demo-loop cycle 3, demo issue m50: "A task added for another day is not shown after
 * Save; the list stays on today". FieldTasksPage.submitAdd appended the new task only when it fell
 * on the day being viewed (`if (made.date === date) setTasks(...)`) and then flashed a plain
 * "Task added" — a task saved for Tue Nov 17 while viewing Thu Nov 12 vanished from sight.
 *
 * Fix: `addedNotice(madeDate, viewedDate, lang)` in front-end/lib/field.ts decides — another day →
 * the page moves to that day (`goTo`) and the flash names it ("Task added for Tue, Nov 17").
 */
import * as fs from "fs";
import * as path from "path";
import { addedNotice, fmtDay } from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const island = read("front-end/islands/FieldTasksPage.tsx");

describe("REQ-526 a task added for another day moves the list to that day (demo m50, cycle 3)", () => {
  test("REQ-526 same day → stay, plain 'Task added'", () => {
    expect(addedNotice("2026-11-12", "2026-11-12", "en")).toEqual({
      goTo: null,
      key: "field.tk.added",
      vars: {},
    });
  });

  test("REQ-526 another day → go to that day and name it in the flash", () => {
    expect(addedNotice("2026-11-17", "2026-11-12", "en")).toEqual({
      goTo: "2026-11-17",
      key: "field.tk.addedFor",
      vars: { day: fmtDay("2026-11-17", "en") },
    });
    expect(addedNotice("2026-11-17", "2026-11-12", "es").vars.day).toBe(
      fmtDay("2026-11-17", "es"),
    );
  });

  test("REQ-526 en/es carry field.tk.addedFor with {day}", () => {
    expect(en["field.tk.addedFor"]).toMatch(/\{day\}/);
    expect(es["field.tk.addedFor"]).toMatch(/\{day\}/);
  });

  test("REQ-526 submitAdd navigates with go(notice.goTo) BEFORE setting the flash (go clears it)", () => {
    const body = island.slice(island.indexOf("async function submitAdd"));
    const ok = body.slice(
      body.indexOf("fieldClient.createTask"),
      body.indexOf("catch (err)"),
    );
    expect(ok).toMatch(/addedNotice\(made\.date, date, lang\)/);
    const goAt = ok.search(/go\(notice\.goTo\)/);
    const flashAt = ok.search(/setFlash\(t\(notice\.key, notice\.vars\)\)/);
    expect(goAt).toBeGreaterThan(-1);
    expect(flashAt).toBeGreaterThan(goAt);
    expect(ok).not.toMatch(/setFlash\(t\("field\.tk\.added"\)\)/);
  });
});
