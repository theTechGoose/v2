/**
 * REQ-870 (demo-loop cycle dm5, issue p7) — "Return to your account" on /admin's guide gate, as
 * the only presenter, ends the demo (REQ-232/235) and must land where the pill's End lands:
 * /admin?demo=ended&by=you ("You ended the demo", REQ-855). The leave says whether it ended the
 * demo; while a colleague stays on it the console opens plain — never "You ended the demo".
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  ADMIN_PATH,
  endedHref,
  returnedHref,
  withLang,
} from "../../shared/demo-mode/ended";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("REQ-870 (dm5 p7) the gate's Return lands with the ended notice when it ended the demo", () => {
  test("ended → the same address End from the pill hands back to, in the gate's language", () => {
    for (const lang of ["en", "es", null, undefined]) {
      expect(returnedHref(true, lang)).toBe(endedHref({ by: "you" }, lang));
    }
    expect(returnedHref(true, "es")).toBe("/admin?demo=ended&by=you&lang=es");
  });

  test("not ended (a colleague stays on it, or the outcome is unknown) → the plain console", () => {
    expect(returnedHref(false, "en")).toBe(withLang(ADMIN_PATH, "en"));
    expect(returnedHref(false, "en")).toBe("/admin?lang=en");
    expect(returnedHref(false, null)).toBe("/admin");
  });

  test("returnToOwnAccount navigates by what the leave answered; the client types `ended`", () => {
    const src = read("front-end/lib/return-to-account.ts");
    expect(src).toMatch(/demoModeClient\.leave\(/);
    expect(src).toMatch(/location\.href = returnedHref\(ended, lang\)/);
    expect(read("front-end/clients/demo-mode.ts")).toMatch(
      /api\.post<\{ ok: true; ended: boolean \}>\(\s*`\/demo-mode\/sessions\/\$\{id\}\/leave`/,
    );
  });

  test("the backend's leave answers { ok: true, ended }", () => {
    const ctl = read(
      "backend/src/demo-mode/entrypoints/demo-mode-controller/mod.ts",
    );
    expect(ctl).toMatch(/return \{ ok: true, ended \};/);
  });
});
