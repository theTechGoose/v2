/**
 * REQ-522 — demo-loop cycle 3, issue m30: the New subscription modal leaked
 * developer copy ("The address is geocoded once on save; the zone is
 * recomputed on the server.") and its net-days hint sent Spanish users to
 * "Ajustes", a page the nav calls "Configuración" (appNav.settings).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const DICTS = { en, es };

// Words a contractor should never read in the subscriptions UI.
const JARGON =
  /geocod|recomput|recalcul|server|servidor|backend|\bAPI\b|endpoint|Mapbox/i;

describe("REQ-522 subscription modal copy (demo m30, cycle 3)", () => {
  for (const lang of ["en", "es"] as const) {
    test(`${lang}: field.subs.* copy carries no developer jargon`, () => {
      const leaks = Object.entries(DICTS[lang])
        .filter(([k, v]) => k.startsWith("field.subs.") && JARGON.test(v))
        .map(([k, v]) => `${k}: ${v}`);
      expect(leaks).toEqual([]);
    });

    test(`${lang}: the address hint tells the user what happens, in plain words`, () => {
      const s = DICTS[lang]["field.subs.geo"];
      expect(s).toBeTruthy();
      expect(s).toMatch(lang === "en" ? /map/i : /mapa/i);
      expect(s).toMatch(lang === "en" ? /save/i : /guardar/i);
    });

    test(`${lang}: the net-days hint names the Settings page by its nav label`, () => {
      const nav = DICTS[lang]["appNav.settings"];
      expect(nav).toBeTruthy();
      expect(DICTS[lang]["field.subs.netDaysHint"]).toContain(nav);
    });
  }

  test("es: no copy calls the settings page 'Ajustes' (the nav says 'Configuración')", () => {
    expect(es["appNav.settings"]).toBe("Configuración");
    const hits = Object.entries(es)
      .filter(([, v]) => /\bAjustes\b/.test(v))
      .map(([k, v]) => `${k}: ${v}`);
    expect(hits).toEqual([]);
  });

  test("the island renders the address hint from field.subs.geo", () => {
    const src = read("front-end/islands/FieldSubscriptionsPage.tsx");
    expect(src).toContain(`<span class="hint">{t("field.subs.geo")}</span>`);
  });
});
