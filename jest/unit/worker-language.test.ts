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

  test("the add form defaults to Spanish, carries a picker, and the row has a switch that PUTs", () => {
    const page = read("front-end/islands/FieldWorkersPage.tsx");
    expect(page).toMatch(/language: "es"/);
    expect(page).toMatch(/data-cy="wk-language"/);
    expect(page).toMatch(/data-cy="wk-row-lang"/);
    expect(page).toMatch(/fieldClient\.setWorkerLanguage/);
    const client = read("front-end/clients/field.ts");
    expect(client).toMatch(/setWorkerLanguage/);
    expect(client).toMatch(/language\?: "en" \| "es"/);
  });
});
