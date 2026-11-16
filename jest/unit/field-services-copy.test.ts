/**
 * REQ-839/840/841/842 — the service catalogue page, the crews and the Away panel on
 * /field/workers, the crew picker on Assignments and the crew lines on Tasks have their
 * words in BOTH languages with no developer jargon; the Services nav entry sits in the
 * Field folder right after Checklists; the route and the island exist.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const DICTS = { en, es };

const JARGON =
  /geocod|recomput|recalcul|server|servidor|backend|\bAPI\b|endpoint|\bid\b|null|undefined|crewId|taskType/i;

const KEYS = [
  "nav.services",
  ...["docTitle", "eyebrow", "title", "sub", "new", "editTitle", "name", "namePh", "description", "descriptionPh", "nameRequired", "empty", "usedBy", "archive", "restore", "archived", "showArchived", "delete", "confirmDelete", "inUse", "nameTaken"].map((k) => `field.svc.${k}`),
  ...["title", "sub", "new", "editTitle", "name", "namePh", "color", "members", "membersNone", "foreman", "foremanNone", "leads", "services", "anyService", "servicesHint", "coversAll", "coversAllHint", "zones.one", "zones.other", "empty", "delete", "confirmDelete", "inUse", "nameTaken", "foremanNotMember", "typeClaimed", "none", "select"].map((k) => `field.crew.${k}`),
  ...["title", "sub", "markOut", "outTitle", "from", "to", "what", "cover", "coverBy", "coverPick", "defer", "skip", "note", "notePh", "empty", "remove", "badDates", "coverRequired", "dispCover", "dispDefer", "dispSkip", "memberHint"].map((k) => `field.away.${k}`),
  "field.tk.coverFor",
  "field.tk.moveAll",
  "field.tk.movedAll",
  "field.tk.crewGroup",
  "field.asg.crews",
  "field.asg.noCrews",
  "field.asg.crewLoad",
  "field.asg.unstaffedCrews",
  "field.asg.manageCrews",
  "worker.crewChip",
];

describe("REQ-839..842 services, crews and absences copy", () => {
  for (const lang of ["en", "es"] as const) {
    test(`${lang}: every key exists and is a non-empty string`, () => {
      const missing = KEYS.filter((k) =>
        typeof DICTS[lang][k] !== "string" || !DICTS[lang][k].trim()
      );
      expect(missing).toEqual([]);
    });
    test(`${lang}: the copy carries no developer jargon`, () => {
      const leaks = Object.entries(DICTS[lang])
        .filter(([k, v]) =>
          (k.startsWith("field.svc.") || k.startsWith("field.crew.") ||
            k.startsWith("field.away.")) && JARGON.test(v)
        )
        .map(([k, v]) => `${k}: ${v}`);
      expect(leaks).toEqual([]);
    });
  }
  test("the two languages differ on the page titles and the nav entry", () => {
    expect(en["nav.services"]).not.toBe(es["nav.services"]);
    expect(en["field.svc.title"]).not.toBe(es["field.svc.title"]);
    expect(en["field.crew.title"]).not.toBe(es["field.crew.title"]);
    expect(en["field.away.title"]).not.toBe(es["field.away.title"]);
  });
  test("the Services nav entry is in the Field folder, right after Checklists, and routes to /field/services", () => {
    const tree = read("front-end/lib/nav-tree.ts");
    const folder = tree.slice(
      tree.indexOf('id: "field"'),
      tree.indexOf("]", tree.indexOf('id: "field"')),
    );
    expect(folder).toContain('id: "services"');
    expect(folder).toContain('href: "/field/services"');
    expect(folder.indexOf('id: "checklists"')).toBeLessThan(
      folder.indexOf('id: "services"'),
    );
    expect(folder.indexOf('id: "services"')).toBeLessThan(
      folder.indexOf('id: "assignments"'),
    );
  });
  test("the route and the island exist", () => {
    expect(fs.existsSync(path.join(ROOT, "front-end/routes/field/services.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "front-end/islands/FieldServicesPage.tsx"))).toBe(true);
  });
});
