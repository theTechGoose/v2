/**
 * REQ-071 — Raphael, 2026-10-14: "replace paperwork monster with DocuMonster
 * everywhere." The site's own brand is DocuMonster: the dictionaries name it,
 * its two-tone halves join to the one word, and no tracked file spells the
 * old brand any more — outside the places the requirement keeps: the
 * attorney's legal text (REQ-065, verbatim: "Paperwork Monster Inc., doing
 * business as DocuMonster Powered by Paperwork Monster"), the production
 * domain paperworkmonster.com, the reference folder the CSS headers cite, and
 * the append-only requirements.md.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { LANDING_DICT } from "../../front-end/lib/landing-dict";

const ROOT = path.resolve(__dirname, "../..");

/** the legal text and what pins it — Hans's October 6 document, verbatim (REQ-065) */
const LEGAL_FILES = [
  "shared/legal/terms.ts",
  "shared/legal/terms.es.ts",
  "jest/unit/legal-terms.test.ts",
  "requirements.md",
  // the two tests that name the old brand in order to assert it is gone
  "jest/unit/brand-name.test.ts",
  "e2e/brand/brand.e2e.test.ts",
];
/** what the requirement keeps, stripped from a line before it is judged */
const KEPT = [
  /DocuMonster Powered by Paperwork Monster/g,
  /DocuMosnter Powered by Paperwork Monster/g, // Hans's email, quoted as written
  /Paperwork Monster Inc\.?/g,
  /paperworkmonster\.com/gi,
  /reference\/paperwork-monsters\//g,
];
const OLD_BRAND = /paperwork[\s_-]*monsters?/i;

/** every tracked text line that mentions the old brand: "path:line:text" (text cut to 100 chars) */
function oldBrandLines(): string[] {
  const exclude = LEGAL_FILES.map((f) => `':!${f}'`).join(" ");
  let files = "";
  try {
    files = execSync(`git grep -I -l -i -E 'paperwork[[:space:]_-]*monster' -- . ${exclude}`, { cwd: ROOT, encoding: "utf8" });
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    if (err.status !== 1) throw e; // 1 = no match
    files = err.stdout ?? "";
  }
  const out: string[] = [];
  for (const file of files.split("\n").filter((f) => f.length > 0)) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((text, i) => {
      const judged = KEPT.reduce((s, re) => s.replace(re, ""), text);
      const hit = judged.match(/.{0,40}paperwork[\s_-]*monsters?.{0,40}/i);
      if (hit) out.push(`${file}:${i + 1}:${hit[0]}`);
    });
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

describe("REQ-071 the brand is DocuMonster", () => {
  it("REQ-071 no tracked file spells the old brand outside the legal text, the domain and requirements.md", () => {
    const lines = oldBrandLines();
    expect(lines.slice(0, 40).join("\n")).toBe("");
    expect(lines.length).toBe(0);
    // and no tracked file is named after it
    const named = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => OLD_BRAND.test(f));
    expect(named).toEqual([]);
  });

  it("REQ-071 the dictionaries name the brand DocuMonster, and its two-tone halves join to the one word", () => {
    for (const [name, dict] of [["en", en], ["es", es]] as const) {
      expect([name, dict["brand.name"]]).toEqual([name, "DocuMonster"]);
      expect([name, dict["brand.namePrefix"] + dict["brand.nameSuffix"]]).toEqual([name, "DocuMonster"]);
      expect([name, dict["topbar.brandHome"]]).toEqual([name, expect.stringContaining("DocuMonster")]);
      // the browser titles that name the brand name DocuMonster; none names the old one
      const titles = Object.keys(dict).filter((k) => k.endsWith("docTitle") || k.endsWith("pageTitle"));
      expect([name, titles.filter((k) => /paperwork\s*monster/i.test(dict[k]))]).toEqual([name, []]);
      expect([name, titles.filter((k) => dict[k].includes("DocuMonster")).length]).toEqual([name, expect.any(Number)]);
      expect(titles.filter((k) => dict[k].includes("DocuMonster")).length).toBeGreaterThanOrEqual(10);
    }
    for (const lang of ["en", "es"] as const) {
      const d = LANDING_DICT[lang] as Record<string, string>;
      expect([lang, d["brand1"] + d["brand2"]]).toEqual([lang, "DocuMonster"]);
      expect([lang, d["footer.copy"]]).toEqual([lang, expect.stringContaining("DocuMonster")]);
    }
  });
});
