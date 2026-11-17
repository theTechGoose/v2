/**
 * REQ-155 — each worker has a language: the add form picks it (Spanish by default), the row's
 * switch changes it, the keys exist in both languages, and the client carries it.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-155 the worker's language", () => {
  test("the keys exist in both languages", () => {
    for (
      const k of [
        "field.wk.language",
        "field.wk.langEs",
        "field.wk.langEn",
        "field.wk.langHint",
      ]
    ) {
      expect([k, typeof en[k]]).toEqual([k, "string"]);
      expect([k, typeof es[k]]).toEqual([k, "string"]);
    }
    expect(en["field.wk.langHint"]).not.toBe(es["field.wk.langHint"]);
  });

  test("the add form carries a picker, and the row has a switch that PUTs", () => {
    const page = read("front-end/islands/FieldWorkersPage.tsx");
    expect(page).toMatch(/data-cy="wk-language"/);
    expect(page).toMatch(/data-cy="wk-row-lang"/);
    expect(page).toMatch(/fieldClient\.setWorkerLanguage/);
    const client = read("front-end/clients/field.ts");
    expect(client).toMatch(/setWorkerLanguage/);
    expect(client).toMatch(/language\?: "en" \| "es"/);
  });
});

/**
 * REQ-774 (demo dv1-d5, cycle dv1) — Raphael: "New workers should default to whatever their
 * language is. When you make a new worker, you should set their language." The add form's
 * picker starts on the app's language (an English account → English), never a hard Spanish.
 */
describe("REQ-774 a new worker's language defaults to the app's, not Spanish", () => {
  const page = read("front-end/islands/FieldWorkersPage.tsx");

  test("the blank form has no hard-coded Spanish: the language is unset until picked", () => {
    const blank = page.match(/const BLANK: AddForm = \{[\s\S]*?\};/);
    expect(blank).not.toBeNull();
    expect(blank![0]).not.toMatch(/language: "es"/);
    expect(blank![0]).toMatch(/language: null/);
  });

  test("the picker shows, and the add sends, the picked language else the app's (langSignal)", () => {
    expect(page).toMatch(/form\.language \?\? langSignal\.value/);
    expect(page).toMatch(/value=\{pickedLang\}/);
    expect(page).toMatch(/language: pickedLang/);
  });

  test("the note under the picker no longer says workers get Spanish", () => {
    expect(en["field.wk.langNote"]).not.toMatch(/Spanish/);
    expect(es["field.wk.langNote"]).not.toMatch(/en español/);
  });
});
