/**
 * REQ-856 — the roof measurement page (/roof): its words exist in BOTH
 * languages with no developer jargon, and the sidebar has a root "Roof
 * measure" row right after Reports.
 */
import * as fs from "fs";
import * as path from "path";
import { isFolder, viewAt } from "../../front-end/lib/nav-folders";
import { NAV } from "../../front-end/lib/nav-tree";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const DICTS = { en, es };

const JARGON =
  /geocod|mercator|bbox|server|servidor|backend|\bAPI\b|endpoint|\bid\b|null|undefined|NAIP|USGS|Overpass/i;

const KEYS = [
  "nav.tools", // REQ-891
  "nav.satellite", // REQ-891
  "roof.kind", // REQ-891
  "roof.kindRoof",
  "roof.kindFlat",
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
  "roof.fetchingPhoto",
  "roof.retry",
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
  test("REQ-891: the sidebar has a Tools folder right after Reports holding Satellite measure (/tools/satellite, ruler icon); the words are 'Tools' / 'Satellite measure'", () => {
    const root = viewAt(NAV, []).items;
    const i = root.findIndex((n) => n.id === "tools");
    expect(i).toBeGreaterThan(0);
    expect(root[i - 1].id).toBe("reports");
    expect(isFolder(root[i])).toBe(true);
    const tools = viewAt(NAV, ["tools"]).items;
    expect(tools.map((n) => n.id)).toEqual(["satellite"]);
    expect(tools[0].href).toBe("/tools/satellite");
    expect(tools[0].icon).toBe("ruler");
    expect(en["nav.tools"]).toBe("Tools");
    expect(en["nav.satellite"]).toBe("Satellite measure");
    expect(es["nav.tools"]).toBe("Herramientas");
    // the page no longer says it is only for roofs
    expect(en["roof.eyebrow"]).toBe("Satellite measure");
    expect(en["roof.title"]).toMatch(/driveway/i); // not only roofs any more
    expect(es["roof.title"]).toMatch(/entrada/i);
  });
  test("REQ-891: the island is SatelliteMeasurePage on /tools/satellite; /roof redirects there (bookmarks and the first release's links keep working)", () => {
    expect(
      fs.existsSync(
        path.join(ROOT, "front-end/islands/SatelliteMeasurePage.tsx"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(ROOT, "front-end/islands/RoofMeasurePage.tsx")),
    ).toBe(false);
    const route = read("front-end/routes/tools/satellite.tsx");
    expect(route).toMatch(/SatelliteMeasurePage/);
    expect(route).toMatch(/active="satellite"/);
    expect(route).toMatch(/pageTitleKey="nav\.satellite"/);
    const old = read("front-end/routes/roof/index.tsx");
    expect(old).toMatch(/\/tools\/satellite/);
    expect(old).toMatch(/302/);
  });
});
