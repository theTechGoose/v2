/**
 * REQ-084 — Raphael, 2026-10-18, on the /landing2 signup card: "make it so there is no autofill."
 * The phone field and the code field ask the browser for nothing: autocomplete off, no name to
 * key a saved value on, and the flags the password managers honour (LastPass, 1Password,
 * Dashlane). No `one-time-code` hint either — the SMS suggestion is autofill too.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const ISLAND = "front-end/islands/Landing2Signup.tsx";

function inputTag(src: string, id: string): string {
  const m = new RegExp(`<input[^>]*id="${id}"[\\s\\S]*?/>`).exec(src);
  if (!m) throw new Error(`no <input id="${id}"> in ${ISLAND}`);
  return m[0];
}

describe("REQ-084 the signup card asks the browser for no autofill", () => {
  test.each(["reg-phone", "reg-code"])("%s: autocomplete off, no name, the managers' ignore flags", (id) => {
    const tag = inputTag(read(ISLAND), id);
    expect(tag).toMatch(/autoComplete="off"/);
    expect(tag).not.toMatch(/\sname=/);
    expect(tag).toMatch(/data-lpignore="true"/);
    expect(tag).toMatch(/data-1p-ignore/);
    expect(tag).toMatch(/data-form-type="other"/);
  });

  test("no one-time-code hint anywhere on the card", () => {
    expect(read(ISLAND)).not.toMatch(/one-time-code/);
  });
});
