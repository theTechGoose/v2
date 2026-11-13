/**
 * REQ-363 — demo-loop cycle 1, issues p15-14 and p15-15 (pair 8): the field
 * module (fd52cfa2) and the admins page (d346384e) were written with Myrtle
 * Beach SC sample data and their own inline helpers, so
 *  - the Workers list avatar sliced the full name: "Miguel Torres" → "MI";
 *  - the phone boxes showed a South Carolina number, (843) 555-0201, to an
 *    Austin business.
 * Guards, so neither comes back anywhere in the app:
 *  - a person's avatar initials come from `initialsOf` (first + last word),
 *    never from slicing a whole `.name`;
 *  - every phone placeholder (an island/component/route `placeholder=` or a
 *    dictionary placeholder key) is the neutral 555 area code — never a real
 *    one that pins the sample to a place.
 */
import * as fs from "fs";
import * as path from "path";
import { initialsOf } from "../../front-end/lib/clients-display";
import { PHONE_PLACEHOLDER } from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DICTS = ["en", "es"].map((l) => ({
  lang: l,
  dict: JSON.parse(read(`lang/${l}.json`)) as Record<string, string>,
}));

/** every .tsx/.ts under the front-end's UI dirs */
function uiFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (
      const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })
    ) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push(r);
      }
    }
  };
  for (
    const d of ["front-end/islands", "front-end/components", "front-end/routes"]
  ) walk(d);
  return out;
}

/**
 * The area code of a phone-number-looking string, or null when it is not one.
 * "(843) 555-0201", "8435550201", "+1 843 555 0201", "Cell (555) 123-4567".
 */
function areaCode(s: string): string | null {
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return d.slice(0, 3);
  if (d.length === 11 && d.startsWith("1")) return d.slice(1, 4);
  return null;
}

/**
 * The public contact form's sample is the company's own (Hans's legal pages,
 * REQ-065) — the one placeholder allowed a real area code.
 */
const ALLOWED_KEYS = new Set(["contactPage.phonePh"]);

describe("REQ-363 p15-14 — avatar initials are word initials, never a slice of the name", () => {
  test("Miguel Torres → MT (first + last word), one word → its first two letters", () => {
    expect(initialsOf("Miguel Torres")).toBe("MT");
    expect(initialsOf("Ana María López")).toBe("AL");
    expect(initialsOf("Luis")).toBe("LU");
  });

  test("the Workers list avatar uses initialsOf", () => {
    const island = read("front-end/islands/FieldWorkersPage.tsx");
    expect(island).toMatch(
      /import\s*\{[^}]*\binitialsOf\b[^}]*\}\s*from\s*"\.\.\/lib\/clients-display\.ts"/,
    );
    expect(island).toContain("initialsOf(w.name)");
  });

  test("no island, component or route slices a whole name into initials", () => {
    const offenders = uiFiles().filter((f) =>
      /\.name\.slice\(\s*0\s*,\s*2\s*\)/.test(read(f))
    );
    expect(offenders).toEqual([]);
  });
});

describe("REQ-363 p15-15 — phone placeholders carry no real area code", () => {
  test("the shared placeholder is the neutral (555) 123-4567", () => {
    expect(PHONE_PLACEHOLDER).toBe("(555) 123-4567");
  });

  test("the worker and admin phone boxes use it", () => {
    for (
      const f of [
        "front-end/islands/FieldWorkersPage.tsx",
        "front-end/islands/AdminsPage.tsx",
      ]
    ) {
      expect({ f, uses: read(f).includes("placeholder={PHONE_PLACEHOLDER}") })
        .toEqual({ f, uses: true });
    }
  });

  test("no placeholder= in an island, component or route is a real-area-code number", () => {
    const offenders: string[] = [];
    for (const f of uiFiles()) {
      for (const m of read(f).matchAll(/placeholder=["']([^"']*)["']/g)) {
        const ac = areaCode(m[1]);
        if (ac !== null && ac !== "555") offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no dictionary placeholder (…Ph / …Placeholder) is a real-area-code number, en or es", () => {
    const offenders: string[] = [];
    for (const { lang, dict } of DICTS) {
      for (const [k, v] of Object.entries(dict)) {
        if (!/(Ph|Placeholder)$/.test(k) || ALLOWED_KEYS.has(k)) continue;
        const ac = areaCode(v);
        if (ac !== null && ac !== "555") offenders.push(`${lang}:${k} = ${v}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("worker.cellPh is the neutral placeholder in both languages", () => {
    for (const { lang, dict } of DICTS) {
      expect({ lang, v: dict["worker.cellPh"] }).toEqual({
        lang,
        v: PHONE_PLACEHOLDER,
      });
    }
  });

  test("the cell formatter's doc no longer uses the 843 sample", () => {
    expect(read("front-end/lib/field.ts")).not.toMatch(/\(843\)/);
  });
});
