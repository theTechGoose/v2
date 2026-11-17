/**
 * REQ-598 (demo-loop cycle 4, issue p4-p10a) — "fix every issue the demo found, loop until there
 * are none". Clearing Settings → Business name showed "Escribe un nombre — solo espacios no
 * cuenta." — the wizard's whitespace-only copy — for a field that was simply empty. An empty
 * name now asks for the business name (settings.businessNameRequired); spaces alone keep
 * welcome.nameBlank.
 */
import * as fs from "fs";
import * as path from "path";
import { businessNameError } from "../../shared/quote-flow/settings-fields";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-598 p4-p10a an emptied business name asks for the name", () => {
  test("empty → settings.businessNameRequired; spaces alone → welcome.nameBlank", () => {
    expect(businessNameError("", "Jensen Roofing")).toBe(
      "settings.businessNameRequired",
    );
    expect(businessNameError("   ", "Jensen Roofing")).toBe(
      "welcome.nameBlank",
    );
    expect(businessNameError("\t", "Jensen Roofing")).toBe(
      "welcome.nameBlank",
    );
    expect(businessNameError("", "")).toBeNull();
    expect(businessNameError("Jensen & Sons", "Jensen Roofing")).toBeNull();
  });

  test("the copy exists in en and es and says nothing about spaces", () => {
    expect(en["settings.businessNameRequired"]).toBe(
      "Type your business name.",
    );
    expect(es["settings.businessNameRequired"]).toBe(
      "Escribe el nombre de tu negocio.",
    );
    expect(en["settings.businessNameRequired"]).not.toMatch(/space/i);
    expect(es["settings.businessNameRequired"]).not.toMatch(/espacio/i);
  });
});
