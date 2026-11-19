/**
 * REQ-975 — LOOP-007 cycle 1, issue q1-55: "Danger zone: the account-wipe block has no heading;
 * the confirm placeholder looks pre-filled". In front-end/islands/SettingsPage.tsx DangerZoneCard,
 * the Reset sub-block (REQ-199) has its own bold title and a bottom border, but the wipe content is
 * a bare <p>{t.wipeIntro}</p> with no title, so "This deletes your account…" reads as part of the
 * Reset block. Both confirm inputs also use the literal keyword as the placeholder
 * (`placeholder={keyword}` → "DELETE"/"ELIMINAR", `placeholder={resetKeyword}` → "RESET"), which
 * looks as if it were already typed.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(ROOT, "front-end/islands/SettingsPage.tsx"),
  "utf8",
);
const en = JSON.parse(
  fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8"),
) as Record<string, string>;
const es = JSON.parse(
  fs.readFileSync(path.join(ROOT, "lang/es.json"), "utf8"),
) as Record<string, string>;

/** The source of DangerZoneCard, from its declaration to the next top-level function. */
function dangerZoneSrc(): string {
  const at = src.indexOf("function DangerZoneCard(");
  if (at < 0) throw new Error("no DangerZoneCard in SettingsPage.tsx");
  const next = src.indexOf("\nfunction ", at + 10);
  return src.slice(at, next < 0 ? undefined : next);
}

/** The JSX of the element carrying data-cy=`cy` (open tag → its matching close, by depth). */
function blockFor(body: string, cy: string): string {
  const at = body.indexOf(`data-cy="${cy}"`);
  if (at < 0) throw new Error(`no data-cy="${cy}" in DangerZoneCard`);
  const open = body.lastIndexOf("<", at);
  const tag = body.slice(open + 1).match(/^[A-Za-z]+/)![0];
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  re.lastIndex = open;
  let depth = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return body.slice(open, m.index + m[0].length);
  }
  throw new Error(`unclosed <${tag}> for data-cy="${cy}"`);
}

/** The <input …/> tag whose attributes contain `marker`. */
function inputTagWith(body: string, marker: string): string {
  const at = body.indexOf(marker);
  if (at < 0) throw new Error(`no input with ${marker} in DangerZoneCard`);
  const open = body.lastIndexOf("<input", at);
  return body.slice(open, body.indexOf("/>", at) + 2);
}

describe("REQ-975 (LOOP-007 q1-55): the Danger zone wipe block has its own heading and no pre-filled-looking placeholder", () => {
  test("REQ-975 both dictionaries carry a wipe title: EN 'Delete account', ES 'Eliminar cuenta'", () => {
    expect(en["settings.wipeTitle"]).toBe("Delete account");
    expect(es["settings.wipeTitle"]).toBe("Eliminar cuenta");
  });

  test("REQ-975 the wipe content sits in its own data-cy='settings-wipe' block whose title is t.wipeTitle, before the intro", () => {
    const wipe = blockFor(dangerZoneSrc(), "settings-wipe");
    const title = wipe.indexOf("{t.wipeTitle}");
    const intro = wipe.indexOf("{t.wipeIntro}");
    expect(title).toBeGreaterThan(-1);
    expect(intro).toBeGreaterThan(title);
    expect(wipe).toContain("aria-label={t.ariaWipeConfirm}");
  });

  test("REQ-975 the wipe confirm input does not use the keyword ('DELETE'/'ELIMINAR') as its placeholder", () => {
    const tag = inputTagWith(dangerZoneSrc(), "aria-label={t.ariaWipeConfirm}");
    expect(tag).not.toMatch(/placeholder=\{\s*keyword\s*\}/);
  });

  test("REQ-975 the reset confirm input does not use the keyword ('RESET') as its placeholder", () => {
    const tag = inputTagWith(
      dangerZoneSrc(),
      'data-cy="settings-reset-confirm-input"',
    );
    expect(tag).not.toMatch(/placeholder=\{\s*resetKeyword\s*\}/);
  });
});
