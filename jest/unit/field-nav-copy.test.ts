/**
 * REQ-361 (demo cycle 1, issue M36) — the field pages live in a folder named for what they are,
 * "Field" / "Campo", not "Recurring"; their copy covers both kinds of work (subscription rounds AND
 * one-off tasks added by hand); and the Workers card's "No zone yet" hint links to Assignments,
 * which sits in the other folder (Workers stays in Roles per REQ-178).
 */
import * as fs from "fs";
import * as path from "path";
import { folderPathTo, viewAt } from "../../front-end/lib/nav-folders";
import { NAV } from "../../front-end/lib/nav-tree";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-361 (demo M36) the field folder, its copy, and the Workers → Assignments link", () => {
  test("the folder is `field`, labelled Field / Campo; no folder or key says Recurring", () => {
    expect(viewAt(NAV, []).items.map((n) => n.id)).toContain("field");
    expect(viewAt(NAV, []).items.map((n) => n.id)).not.toContain("recurring");
    for (const id of ["subscriptions", "assignments", "tasks", "batches"]) {
      expect(folderPathTo(NAV, id)).toEqual(["field"]);
    }
    expect(en["nav.field"]).toBe("Field");
    expect(es["nav.field"]).toBe("Campo");
    expect(en["nav.recurring"]).toBeUndefined();
    expect(es["nav.recurring"]).toBeUndefined();
  });

  test("the four field-page lines name one-off tasks as well as subscriptions, in both languages", () => {
    const keys = [
      "field.asg.title",
      "field.asg.noRegions",
      "field.tk.sub",
      "field.tk.none",
    ];
    for (const k of keys) {
      expect([k, /one-off|Add task/i.test(en[k] ?? "")]).toEqual([k, true]);
      expect([k, /suelta|Agregar tarea/i.test(es[k] ?? "")]).toEqual([k, true]);
    }
    // "No tasks for this day" no longer blames subscriptions alone: it says how to add one
    expect(en["field.tk.none"]).toMatch(/Add task/);
    expect(es["field.tk.none"]).toMatch(/Agregar tarea/);
  });

  test("the Workers card's 'No zone yet' hint is a link to /field/assignments", () => {
    const src = read("front-end/islands/FieldWorkersPage.tsx");
    expect(src).toMatch(
      /<a\s[^>]*href="\/field\/assignments"[^>]*>\s*\{t\("field\.wk\.coversNone"\)\}\s*<\/a>/,
    );
    expect(src).not.toMatch(
      /<span class="hint">\{t\("field\.wk\.coversNone"\)\}/,
    );
  });
});
