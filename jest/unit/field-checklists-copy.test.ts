/**
 * REQ-811 — a checklist a repeat visit references: the /field/checklists page
 * and the Checklist select on /field/subscriptions have their words in BOTH
 * languages, with no developer jargon, the nav entry sits in the Field folder
 * right after Repeat visits, and `ownItems` keeps only the visit's own rows.
 */
import * as fs from "fs";
import * as path from "path";
import { ownItems } from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const DICTS = { en, es };

const JARGON =
  /geocod|recomput|recalcul|server|servidor|backend|\bAPI\b|endpoint|\bid\b|null|undefined/i;

const KEYS = [
  "nav.checklists",
  "field.ckl.docTitle",
  "field.ckl.eyebrow",
  "field.ckl.title",
  "field.ckl.sub",
  "field.ckl.new",
  "field.ckl.editTitle",
  "field.ckl.name",
  "field.ckl.namePh",
  "field.ckl.empty",
  "field.ckl.nameRequired",
  "field.ckl.usedBy.one",
  "field.ckl.usedBy.other",
  "field.ckl.perVisit",
  "field.ckl.inUse",
  "field.ckl.nameTaken",
  "field.ckl.confirmDelete",
  "field.subs.checklist",
  "field.subs.checklistNone",
  "field.subs.checklistHint",
  "field.subs.manageChecklists",
  "field.subs.extraTypes",
  "field.subs.fromChecklist",
  "field.subs.noItemsOrChecklist",
];

describe("REQ-811 checklist copy", () => {
  for (const lang of ["en", "es"] as const) {
    test(`${lang}: every checklist key exists and is a non-empty string`, () => {
      const missing = KEYS.filter((k) =>
        typeof DICTS[lang][k] !== "string" || !DICTS[lang][k].trim()
      );
      expect(missing).toEqual([]);
    });
    test(`${lang}: field.ckl.* copy carries no developer jargon`, () => {
      const leaks = Object.entries(DICTS[lang])
        .filter(([k, v]) =>
          (k.startsWith("field.ckl.") ||
            k.startsWith("field.subs.checklist")) && JARGON.test(v)
        )
        .map(([k, v]) => `${k}: ${v}`);
      expect(leaks).toEqual([]);
    });
  }
  test("the two languages differ on the page title and the nav entry", () => {
    expect(en["nav.checklists"]).not.toBe(es["nav.checklists"]);
    expect(en["field.ckl.title"]).not.toBe(es["field.ckl.title"]);
  });
  test("the nav entry is in the Field folder, right after Repeat visits, and routes to /field/checklists", () => {
    const tree = read("front-end/lib/nav-tree.ts");
    const folder = tree.slice(
      tree.indexOf('id: "field"'),
      tree.indexOf("]", tree.indexOf('id: "field"')),
    );
    expect(folder).toContain('id: "checklists"');
    expect(folder).toContain('href: "/field/checklists"');
    expect(folder.indexOf('id: "subscriptions"')).toBeLessThan(
      folder.indexOf('id: "checklists"'),
    );
    expect(folder.indexOf('id: "checklists"')).toBeLessThan(
      folder.indexOf('id: "assignments"'),
    );
  });
  test("the route and the island exist", () => {
    expect(
      fs.existsSync(path.join(ROOT, "front-end/routes/field/checklists.tsx")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(ROOT, "front-end/islands/FieldChecklistsPage.tsx"),
      ),
    ).toBe(true);
  });
});

describe("REQ-811 ownItems", () => {
  test("keeps the visit's own rows and drops the checklist's", () => {
    const items = [
      {
        taskTypeId: "mow",
        taskTypeName: "Mow",
        priceCents: 6500,
        fromChecklist: true as const,
      },
      { taskTypeId: "edge", taskTypeName: "Edge", priceCents: 3000 },
      {
        taskTypeId: "blow",
        taskTypeName: "Blow",
        priceCents: 1500,
        fromChecklist: true as const,
      },
    ];
    expect(ownItems({ items }).map((i) => i.taskTypeId)).toEqual(["edge"]);
    expect(ownItems({ items: [] })).toEqual([]);
  });
});
