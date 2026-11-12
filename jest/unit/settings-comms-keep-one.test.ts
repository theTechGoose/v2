/**
 * REQ-500 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue M34: Settings → "Languages you send in" let
 * BOTH boxes be unticked (no warning), and after a reload Spanish was ticked
 * again.
 *
 * RCA (M34): SettingsPage's checkbox onChange hit `if (set.size === 0) return;`
 * on the last untick — no save, no state change — so Preact left the
 * controlled box unticked in the DOM. The wizard never had this: it disables
 * the last ticked box and shows welcome.commsLangKeepOne. The rule now lives in
 * shared/quote-flow/comms-language.ts and Settings follows it.
 */
import * as fs from "fs";
import * as path from "path";
import {
  isLastSendLanguage,
  toggleSendLanguage,
} from "../../shared/quote-flow/comms-language";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-500 Settings keeps at least one send-in language (demo cycle 3, M34)", () => {
  test("REQ-500 the only ticked language is the last one; with two ticked, neither is", () => {
    expect(isLastSendLanguage(["en"], "en")).toBe(true);
    expect(isLastSendLanguage(["es"], "es")).toBe(true);
    expect(isLastSendLanguage(["es"], "en")).toBe(false);
    expect(isLastSendLanguage(["en", "es"], "en")).toBe(false);
    expect(isLastSendLanguage(["en", "es"], "es")).toBe(false);
  });

  test("REQ-500 toggling gives the next list in en, es order — never an empty one", () => {
    expect(toggleSendLanguage(["en", "es"], "en", false)).toEqual(["es"]);
    expect(toggleSendLanguage(["es"], "en", true)).toEqual(["en", "es"]);
    expect(toggleSendLanguage(["en"], "es", true)).toEqual(["en", "es"]);
    // the demo's path: English already off, now Spanish off → refused
    expect(toggleSendLanguage(["es"], "es", false)).toBeNull();
    expect(toggleSendLanguage(["en"], "en", false)).toBeNull();
  });

  test("REQ-500 Settings disables the last ticked box and shows the keep-one hint, like the wizard", () => {
    const src = read("front-end/islands/SettingsPage.tsx");
    expect(src).toContain("isLastSendLanguage(selected, lng.code)");
    expect(src).toContain("toggleSendLanguage(");
    expect(src).toContain("data-cy={`settings-comms-${lng.code}`}");
    expect(src).toContain('data-cy="settings-comms-keep-one"');
    expect(src).toContain('"welcome.commsLangKeepOne"');
    // the silent early return that left the DOM box unticked is gone
    expect(src).not.toContain("if (set.size === 0) return;");
  });

  test("REQ-500 the keep-one hint exists in English and Spanish", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["welcome.commsLangKeepOne"]).toMatch(/at least one language/i);
    expect(es["welcome.commsLangKeepOne"]).toMatch(/al menos un idioma/i);
  });
});
