/**
 * REQ-856 — the roof measurement page (/roof): its words exist in BOTH
 * languages with no developer jargon, and the sidebar has a root "Roof
 * measure" row right after Reports.
 */
import * as fs from "fs";
import * as path from "path";
import { viewAt } from "../../front-end/lib/nav-folders";
import { NAV } from "../../front-end/lib/nav-tree";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const DICTS = { en, es };

const JARGON =
  /geocod|mercator|bbox|server|servidor|backend|\bAPI\b|endpoint|\bid\b|null|undefined|NAIP|USGS|Overpass/i;

const KEYS = [
  "nav.roof",
  "roof.docTitle",
  "roof.eyebrow",
  "roof.title",
  "roof.sub",
  "roof.address",
  "roof.addressPh",
  "roof.useTyped",
  "roof.locate",
  "roof.locating",
  "roof.notFound",
  "roof.imageFailed",
  "roof.window",
  "roof.nudge",
  "roof.howTo",
  "roof.closeFacet",
  "roof.undo",
  "roof.clear",
  "roof.useOutline",
  "roof.noOutline",
  "roof.facet",
  "roof.pitch",
  "roof.plan",
  "roof.surface",
  "roof.remove",
  "roof.waste",
  "roof.totalPlan",
  "roof.totalSurface",
  "roof.withWaste",
  "roof.squares",
  "roof.save",
  "roof.saving",
  "roof.saved",
  "roof.savedTitle",
  "roof.savedEmpty",
  "roof.open",
  "roof.delete",
  "roof.confirmDelete",
  "roof.imagery",
  "roof.imageryUnknown",
  "roof.noFacets",
  "roof.error",
];

describe("REQ-856 roof measurement copy", () => {
  for (const lang of ["en", "es"] as const) {
    test(`${lang}: every roof key exists and is a non-empty string`, () => {
      const missing = KEYS.filter((k) =>
        typeof DICTS[lang][k] !== "string" || !DICTS[lang][k].trim()
      );
      expect(missing).toEqual([]);
    });
    test(`${lang}: roof.* copy carries no developer jargon`, () => {
      const leaks = Object.entries(DICTS[lang])
        .filter(([k, v]) => k.startsWith("roof.") && JARGON.test(v))
        .map(([k]) => k);
      expect(leaks).toEqual([]);
    });
  }
  test("the sidebar root has a Roof measure row (/roof, ruler icon) right after Reports", () => {
    const root = viewAt(NAV, []).items;
    const i = root.findIndex((n) => n.id === "roof");
    expect(i).toBeGreaterThan(0);
    expect(root[i - 1].id).toBe("reports");
    expect(root[i].href).toBe("/roof");
    expect(root[i].icon).toBe("ruler");
  });
});
