/**
 * REQ-511 — demo-loop cycle 3, issues m41 + p8-pair6-d. Settings' "Edit details" card
 * (EditCard in front-end/islands/SettingsPage.tsx):
 *  - m41: a refused logo file showed its error at the very bottom of the card (EditPanel's `err`),
 *    under the languages and time zone and off-screen — it read as "silently ignored". The logo's
 *    error now sits in the logo row (its own `logoErr`), and the format + size hint stays visible
 *    after a logo is set ("Replace logo"), naming the accepted types and the 8 MB upload limit.
 *  - p8-pair6-d: EditCard never passed `saved` to EditPanel, so no save of the card (name, email,
 *    business, logo, languages) ever showed "Saved ✓". It now does, cleared on the next edit.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const page = read("front-end/islands/SettingsPage.tsx");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

/** The body of a top-level function, from its declaration to the next top-level declaration. */
function body(decl: string): string {
  const start = page.indexOf(decl);
  if (start < 0) throw new Error(`${decl} not found`);
  const rest = page.slice(start + decl.length);
  const end = rest.search(
    /\n(?:export )?(?:default )?(?:function|const|type|interface) /,
  );
  return end < 0 ? rest : rest.slice(0, end);
}
/** The body of an inner `async function name(` up to the next inner function. */
function inner(src: string, decl: string): string {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`${decl} not found`);
  const rest = src.slice(start + decl.length);
  const end = rest.search(/\n  (?:async )?function |\n  return \(/);
  return end < 0 ? rest : rest.slice(0, end);
}

const card = body("function EditCard(");

describe("REQ-511 (demo cycle 3, m41) a refused logo is reported in the logo row", () => {
  test("REQ-511 EditCard keeps the logo's error apart from the card's error", () => {
    expect(card).toMatch(
      /const \[logoErr, setLogoErr\] = useState<string \| null>\(null\)/,
    );
  });

  test("REQ-511 a non-image pick and a failed upload set logoErr, not the bottom-of-card err", () => {
    const pick = inner(card, "async function onLogoPick(");
    expect(pick).toMatch(/setLogoErr\(t\.logoNotImage\)/);
    expect(pick).toMatch(/setLogoErr\(\s*uploadErrorMessage\(/);
    expect(pick).not.toMatch(/setErr\(/);
  });

  test("REQ-511 the server's 422 logo_not_image lands in logoErr too", () => {
    const save = inner(card, "async function saveIdentity(");
    expect(save).toMatch(
      /"logoFileId" in patch\)\s*\{?\s*setLogoErr\(t\.logoNotImage\)/,
    );
  });

  test("REQ-511 the logo error renders right under the logo button, before the app-language field", () => {
    const errAt = card.indexOf('data-cy="settings-logo-error"');
    const fileAt = card.indexOf('data-cy="settings-logo-file"');
    const langAt = card.indexOf("{t.appLang}");
    expect(errAt).toBeGreaterThan(fileAt);
    expect(errAt).toBeLessThan(langAt);
    expect(card.slice(errAt - 400, errAt + 200)).toMatch(/logoErr/);
    expect(card.slice(errAt - 400, errAt + 200)).toMatch(/role="alert"/);
  });

  test("REQ-511 the format + size hint shows whether or not a logo is set", () => {
    const hintAt = card.indexOf('data-cy="settings-logo-hint"');
    expect(hintAt).toBeGreaterThan(0);
    // not the else-branch of `logoFileId ? (preview) : (hint)` any more
    expect(card).not.toMatch(/\)\s*:\s*\(\s*<span[^>]*>\s*\{t\.logoHint\}/);
  });

  test("REQ-511 the hint names every accepted type and the 8 MB limit, in en and es", () => {
    for (const d of [en, es]) {
      for (const ty of ["PNG", "JPG", "GIF", "WebP"]) {
        expect(d["settings.logoHint"]).toContain(ty);
      }
      expect(d["settings.logoHint"]).toMatch(/8 MB/);
    }
  });
});

describe("REQ-511 (demo cycle 3, p8-pair6-d) an Edit details save shows Saved ✓", () => {
  test("REQ-511 EditCard owns a saved flag and hands it to EditPanel", () => {
    expect(card).toMatch(/const \[saved, setSaved\] = useState\(false\)/);
    const panel = card.slice(
      card.indexOf("<EditPanel"),
      card.indexOf(">", card.indexOf("savedLabel=")),
    );
    expect(panel).toMatch(/saved=\{saved\}/);
  });

  test("REQ-511 saveUser and saveIdentity mark saved after the request resolves, and clear it when one starts", () => {
    for (
      const fn of ["async function saveUser(", "async function saveIdentity("]
    ) {
      const src = inner(card, fn);
      const awaitAt = src.search(/await profileClient\./);
      const setTrue = src.indexOf("setSaved(true)");
      expect(awaitAt).toBeGreaterThan(0);
      expect(setTrue).toBeGreaterThan(awaitAt);
      expect(src.indexOf("setSaved(false)")).toBeGreaterThanOrEqual(0);
      expect(src.indexOf("setSaved(false)")).toBeLessThan(awaitAt);
    }
  });

  test("REQ-511 typing in a field clears the Saved ✓ (cleared on edit)", () => {
    for (
      const setter of ["setName", "setEmail", "setBiz", "setSite", "setNetDays"]
    ) {
      expect(card).toMatch(
        new RegExp(
          `onInput=\\{\\(e\\) => \\{\\s*setSaved\\(false\\);\\s*${setter}\\(`,
        ),
      );
    }
  });

  test("REQ-511 picking a new logo clears the previous Saved ✓ and its error", () => {
    const pick = inner(card, "async function onLogoPick(");
    expect(pick).toMatch(/setSaved\(false\)/);
    expect(pick).toMatch(/setLogoErr\(null\)/);
  });
});
