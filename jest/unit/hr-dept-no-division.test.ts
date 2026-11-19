/**
 * REQ-1002 (LOOP-007 q1-89, amends REQ-887) — the departments page carries no call-centre
 * "Division: Inbound / Outbound" field: not on the Add department modal, not on the configure
 * page, not as a table column, and the dictionaries no longer ship the Inbound/Outbound
 * (Entrante/Saliente) labels for it.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;
const PAGE = "front-end/islands/HrDepartmentsPage.tsx";

describe("REQ-1002 HR departments: no Inbound/Outbound division", () => {
  test("REQ-1002a the departments island renders no inbound/outbound option and no division select", () => {
    const src = read(PAGE);
    expect(src).not.toMatch(/<option value="(inbound|outbound)"/);
    expect(src).not.toMatch(/hr\.depts\.(inbound|outbound)/);
    expect(src).not.toMatch(/hr\.depts\.division/);
    expect(src).not.toMatch(/data-cy="hr-dept-new-division"/);
  });

  test("REQ-1002b the departments table has no Division column", () => {
    const src = read(PAGE);
    expect(src).not.toMatch(/hr\.depts\.col\.division/);
    expect(src).not.toMatch(/hr\.depts\.\$\{d\.division\}/);
  });

  test("REQ-1002c neither dictionary ships the Division / Inbound / Outbound department labels", () => {
    for (const lang of ["lang/en.json", "lang/es.json"]) {
      const d = dict(lang);
      for (const key of [
        "hr.depts.division",
        "hr.depts.inbound",
        "hr.depts.outbound",
        "hr.depts.col.division",
      ]) {
        expect({ lang, key, value: d[key] }).toEqual({
          lang,
          key,
          value: undefined,
        });
      }
      const values = Object.entries(d)
        .filter(([k]) => k.startsWith("hr.depts."))
        .map(([, v]) => v);
      for (const word of ["Inbound", "Outbound", "Entrante", "Saliente"]) {
        expect(values.filter((v) => v === word)).toEqual([]);
      }
    }
  });
});
