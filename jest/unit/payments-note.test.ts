/**
 * REQ-960 (LOOP-007 cycle 1, q1-36) — a /payments card's text line must come from the payment
 * the owner recorded by hand (REQ-018): the method, the payer and the reference they typed.
 * It must not invent how the money moved ("deposited via mobile", "por la app", "auto-pay
 * cleared", "funds settle in 2 days", "logged from the truck").
 *
 * The real `noteFor` is lifted out of front-end/islands/PaymentsPage.tsx (it is not exported),
 * transpiled, and run with the real dictionaries. Contract the fix must keep:
 *   noteFor(lang, method, daysAgo, client, reference?)  — reference is the Payment's `reference`.
 */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const ISLAND = "front-end/islands/PaymentsPage.tsx";
const src = read(ISLAND);
const DICTS: Record<string, Record<string, string>> = {
  en: JSON.parse(read("lang/en.json")),
  es: JSON.parse(read("lang/es.json")),
};

/** same lookup + interpolation as front-end/lib/i18n.ts tFor */
function tFor(lang: string, key: string, vars?: Record<string, unknown>) {
  const v = DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
  if (!vars) return v;
  return v.replace(
    /\{(\w+)\}/g,
    (_, k) => (k in vars ? String(vars[k]) : `{${k}}`),
  );
}

/** the text of a top-level `function <name>(` declaration, brace-matched */
function liftFunction(name: string): string {
  const start = src.search(new RegExp(`\\nfunction ${name}\\s*\\(`));
  if (start < 0) throw new Error(`${ISLAND} has no function ${name}`);
  const open = src.indexOf("{", src.indexOf(")", start));
  let i = open, depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

type NoteFor = (
  lang: string,
  method: string,
  daysAgo: number,
  client: string,
  reference?: string,
) => string;

const noteFor: NoteFor = (() => {
  const js = ts.transpileModule(liftFunction("noteFor"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function("tFor", `${js}\nreturn noteFor;`)(tFor) as NoteFor;
})();

const INVENTED = /mobile|móvil|via\b|por la app|\bapp\b|auto-pay|automático|settle|liquidan|truck|camioneta/i;

describe("REQ-960 q1-36: a /payments card states only what the owner recorded", () => {
  for (const lang of ["en", "es"]) {
    test(`REQ-960 ${lang}: a check recorded with ref 1042 shows the ref and no deposit channel`, () => {
      const note = noteFor(lang, "check", 3, "Luis Ortega", "1042");
      expect(note).toContain("Luis");
      expect(note).toContain("1042");
      expect(note).not.toMatch(INVENTED);
    });

    test(`REQ-960 ${lang}: a check recorded without a ref invents no deposit channel`, () => {
      const note = noteFor(lang, "check", 3, "Luis Ortega");
      expect(note).toContain("Luis");
      expect(note).not.toMatch(INVENTED);
    });

    test(`REQ-960 ${lang}: ach, card, cash (today and older) notes state no settlement facts`, () => {
      for (const [method, days] of [["ach", 2], ["card", 1], ["cash", 0], ["cash", 4]] as const) {
        const note = noteFor(lang, method, days, "Luis Ortega", "1042");
        expect(`${method}/${days}: ${note}`).not.toMatch(INVENTED);
        expect(`${method}/${days}: ${note}`).toContain("1042");
      }
    });

    test(`REQ-960 ${lang}: no paymentsPage.note.* string invents how the money moved`, () => {
      const bad = Object.entries(DICTS[lang])
        .filter(([k]) => k.startsWith("paymentsPage.note."))
        .filter(([, v]) => /mobile|móvil|por la app|auto-pay|automático|settle|liquida|truck|camioneta/i.test(v));
      expect(bad).toEqual([]);
    });
  }

  test("REQ-960: enrich() hands the payment's reference to noteFor", () => {
    const enrich = liftFunction("enrich");
    expect(enrich).toMatch(/noteFor\([^)]*p\.reference/);
  });
});
