/**
 * REQ-520 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue m19 ("New worker form defaults to Spanish on
 * an English account; 'Add' stays grey with no reason (3-digit PIN)").
 *
 * RCA: FieldWorkersPage gated the submit button on `canAdd` (name && 10-digit
 * phone && 4-digit PIN) with `disabled={!canAdd}`, so the browser's own
 * required/pattern validation never ran and nothing said WHY the button was
 * grey. Field errors only rendered for server refusals. Now `addFormProblems`
 * (front-end/lib/field-worker-errors.ts) names each invalid box; the page keeps
 * Add enabled, shows the problem under a box once it is touched (blurred) and
 * under every bad box on a submit, and never POSTs an invalid form. The
 * Spanish default (REQ-155) stays, with a visible one-line language note.
 * Browser proof: e2e/field-worker-form-hints/field-worker-form-hints.e2e.test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { addFormProblems } from "../../front-end/lib/field-worker-errors";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const ok = { name: "Luis", phone: "5125550101", pin: "1234" };

describe("REQ-520 (demo cycle 3, m19) the new-worker form says why it can't add", () => {
  test("a valid form has no problems", () => {
    expect(addFormProblems(ok)).toEqual({});
  });

  test("a 3-digit PIN is the pin4 problem, under the PIN box", () => {
    expect(addFormProblems({ ...ok, pin: "123" })).toEqual({
      pin: "field.wk.err.pin4",
    });
  });

  test("a short phone is the phone10 problem; a blank name is nameRequired", () => {
    expect(addFormProblems({ name: "  ", phone: "512555", pin: "" }))
      .toEqual({
        name: "field.wk.err.nameRequired",
        phone: "field.wk.err.phone10",
        pin: "field.wk.err.pin4",
      });
  });

  test("the language note is worded in en and es", () => {
    for (const d of [en, es]) {
      expect(typeof d["field.wk.langNote"]).toBe("string");
      expect(d["field.wk.langNote"].length).toBeGreaterThan(10);
    }
    expect(en["field.wk.langNote"]).not.toBe(es["field.wk.langNote"]);
    // REQ-774 AMENDMENT (reconciled on demo-fixes): the note no longer says Spanish is the
    // default — it says the worker gets the language picked here.
    expect(en["field.wk.langNote"]).toMatch(/language/);
    expect(es["field.wk.langNote"]).toMatch(/idioma/);
  });

  test("the island keeps Add enabled (only busy while adding) and wires the problems", () => {
    const src = read("front-end/islands/FieldWorkersPage.tsx");
    expect(src).not.toMatch(/disabled=\{!canAdd\}/);
    expect(src).toMatch(/disabled=\{adding\}/);
    expect(src).toMatch(/addFormProblems\(/);
    expect(src).toMatch(/onBlur=/);
    expect(src).toMatch(/data-cy="wk-lang-note"/);
    expect(src).toMatch(/t\("field\.wk\.langNote"\)/);
  });
});
