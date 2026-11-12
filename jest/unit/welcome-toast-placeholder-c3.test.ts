/**
 * REQ-506 — demo cycle 3, issues m26 + s8: a fresh staff account landing on
 * /dashboard?welcome=back saw the toast "Bienvenido de nuevo, Nuevo." — the
 * island took the first word of /api/me's name, and the seeded sign-in
 * placeholder "Nuevo usuario" / "New user" gave "Nuevo" / "New".
 *
 *   - the placeholder (or a blank name) is no name: the toast reads the
 *     nameless `welcomeBackToast.noName` ("¡Bienvenido de nuevo!") in the
 *     live language — never "Nuevo"/"New", never the old "amigo"/"friend";
 *   - a real name still greets by first name;
 *   - the island routes /api/me's name through that one pure rule.
 */
import * as fs from "fs";
import * as path from "path";
import { welcomeBackMessage } from "../../front-end/lib/greeting-identity";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const dicts: Record<"en" | "es", Record<string, string>> = {
  en: require("../../lang/en.json"),
  es: require("../../lang/es.json"),
};
const tIn =
  (lang: "en" | "es") => (key: string, vars?: Record<string, string>) =>
    Object.entries(vars ?? {}).reduce(
      (s, [k, v]) => s.replace(`{${k}}`, v),
      dicts[lang][key] ?? key,
    );
// the "welcome.back" templates from front-end/lib/lang.ts STRINGS
const TPL = {
  en: "Welcome back, {firstName}.",
  es: "Bienvenido de nuevo, {firstName}.",
};

describe("REQ-506 the welcome-back toast never greets the seeded placeholder", () => {
  test("REQ-506 the nameless toast copy exists in en and es", () => {
    expect(dicts.es["welcomeBackToast.noName"]).toBe("¡Bienvenido de nuevo!");
    expect(dicts.en["welcomeBackToast.noName"]).toBe("Welcome back!");
  });

  test.each(
    [
      ["es", "Nuevo usuario"],
      ["es", "  Nuevo usuario "],
      ["en", "New user"],
      ["es", "New user"],
      ["en", "Nuevo usuario"],
      ["es", ""],
      ["es", undefined],
      ["en", null],
    ] as const,
  )(
    "REQ-506 %s / %j → the nameless greeting, never 'Nuevo'/'New'/'amigo'",
    (lang, name) => {
      const msg = welcomeBackMessage(tIn(lang), TPL[lang], name);
      expect(msg).toBe(dicts[lang]["welcomeBackToast.noName"]);
      expect(msg).not.toMatch(/Nuevo|New\b|amigo|friend|\{firstName\}/);
    },
  );

  test("REQ-506 a real name still greets by first name", () => {
    expect(welcomeBackMessage(tIn("es"), TPL.es, "Hans Gruber")).toBe(
      "Bienvenido de nuevo, Hans.",
    );
    expect(welcomeBackMessage(tIn("en"), TPL.en, " Maria ")).toBe(
      "Welcome back, Maria.",
    );
  });

  test("REQ-506 the island renders through welcomeBackMessage, not a raw first word", () => {
    const src = read("front-end/islands/WelcomeBackToast.tsx");
    expect(src).toMatch(/welcomeBackMessage\(/);
    expect(src).not.toMatch(/split\(\/\\s\+\/\)\[0\]/);
    expect(src).not.toMatch(/welcomeBackToast\.nameFallback/);
  });
});
