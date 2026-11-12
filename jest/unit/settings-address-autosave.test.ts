/**
 * REQ-516 — demo-loop cycle 3, demo issue p8-pair6-b: "'se guardan al instante' next to a
 * 'Guardar dirección' button". /settings promises changes save as you go (settings.heroSub), and
 * the mailing-address card already autosaves (debounced keepalive PUT, flushed on blur and
 * pagehide) — so it must not also render an explicit Save button. Its feedback is the card's own
 * "Saving…" / "Saved ✓" status (EditPanel `busy` / `saved`).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const page = fs.readFileSync(
  path.join(ROOT, "front-end/islands/SettingsPage.tsx"),
  "utf8",
);
const en = JSON.parse(
  fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8"),
) as Record<string, string>;
const es = JSON.parse(
  fs.readFileSync(path.join(ROOT, "lang/es.json"), "utf8"),
) as Record<string, string>;

/** The body of a top-level function, from its declaration to the next top-level declaration. */
function body(decl: string): string {
  const start = page.indexOf(decl);
  if (start < 0) throw new Error(`${decl} not found`);
  const rest = page.slice(start + decl.length);
  const end = rest.search(
    /\n(?:\/\*\*|(?:export )?(?:default )?(?:function|const|type|interface) )/,
  );
  return end < 0 ? rest : rest.slice(0, end);
}

describe("REQ-516 the mailing-address card autosaves with no explicit Save button", () => {
  const card = body("function AddressEditCard(");

  test("REQ-516 AddressEditCard renders no <button> (no 'Save address' / 'Guardar dirección')", () => {
    expect(card).not.toMatch(/<button\b/);
    expect(card).not.toMatch(/saveAddress/);
  });

  test("REQ-516 the card still autosaves and reports it through the panel's Saved status", () => {
    expect(card).toMatch(/queueAutosave\(/);
    expect(card).toMatch(/onBlur=\{flushAutosave\}/);
    expect(card).toMatch(/addEventListener\("pagehide"/);
    expect(card).toMatch(/saved=\{saved\}/);
    expect(card).toMatch(/savedLabel=\{t\.saved\}/);
  });

  test("REQ-516 the hero still promises instant save, in both languages", () => {
    expect(en["settings.heroSub"]).toMatch(/save as you go/);
    expect(es["settings.heroSub"]).toMatch(/se guardan al instante/);
  });

  test("REQ-516 the dead 'Save address' string is gone from en and es together", () => {
    expect("settings.saveAddress" in en).toBe(false);
    expect("settings.saveAddress" in es).toBe(false);
  });
});
