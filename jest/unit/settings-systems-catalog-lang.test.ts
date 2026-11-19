/**
 * REQ-1034 (LOOP-007 q2, q2-18) — Settings › Systems › HR onboarding catalog follows the
 * account's language. The catalog (backend SYSTEM_CATALOG, REQ-913) ships English name/desc as
 * API defaults; the tab must render built-ins by key through t("hr.systems.cat.<key>.name|desc"),
 * both for catalog cards and for attached built-in systems (whose stored name/desc were copied
 * from the English catalog), falling back to s.name/s.desc only for custom systems.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (rel: string) => JSON.parse(read(rel)) as Record<string, string>;

/** the built-in keys of SYSTEM_CATALOG, read off the backend source (a Deno module) */
function catalogKeys(): string[] {
  const src = read("backend/src/hr/domain/data/hr-stores/mod.ts");
  const start = src.indexOf("export const SYSTEM_CATALOG");
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("];", start));
  return [...body.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("REQ-1034 (q2-18) the HR systems catalog is translated", () => {
  test("REQ-1034 every SYSTEM_CATALOG key has hr.systems.cat.<key>.name and .desc in en and es", () => {
    const keys = catalogKeys();
    expect(keys).toEqual(["dm-worker", "dm-admin", "dm-email", "dm-text"]);
    const en = dict("lang/en.json"), es = dict("lang/es.json");
    const missing: string[] = [];
    for (const k of keys) {
      for (const f of ["name", "desc"]) {
        const id = `hr.systems.cat.${k}.${f}`;
        if (!en[id]) missing.push(`en:${id}`);
        if (!es[id]) missing.push(`es:${id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("REQ-1034 the Spanish catalog strings are Spanish, not the English catalog text", () => {
    const es = dict("lang/es.json");
    for (
      const english of [
        "DocuMonster worker account",
        "DocuMonster editor",
        "Welcome email (Postmark)",
        "Welcome text (your line)",
      ]
    ) {
      expect(Object.values(es)).not.toContain(english);
    }
    expect(es["hr.systems.cat.dm-worker.name"] ?? "").not.toMatch(
      /worker account/i,
    );
    expect(es["hr.systems.cat.dm-text.name"] ?? "").not.toMatch(
      /welcome text/i,
    );
  });

  test("REQ-1034 SystemsTab renders catalog cards by key, never c.name / c.desc raw", () => {
    const tab = read("front-end/components/SystemsTab.tsx");
    expect(tab).not.toMatch(/\{\s*c\.name\s*\}/);
    expect(tab).not.toMatch(/\{\s*c\.desc\s*\}/);
    expect(tab).toContain("hr.systems.cat.");
  });

  test("REQ-1034 an attached built-in system card is translated by key; only custom systems print s.name / s.desc", () => {
    const tab = read("front-end/components/SystemsTab.tsx");
    const card = tab.slice(tab.indexOf('data-cy="hr-sys-card"'));
    // the attached card's name/desc must not be the raw stored English for built-ins
    expect(card).not.toMatch(/data-cy="hr-sys-name">\{\s*s\.name\s*\}/);
    expect(card).not.toMatch(
      /\{\s*s\.desc\s*&&\s*<div class="hr-sys__desc">\{\s*s\.desc\s*\}/,
    );
  });
});
