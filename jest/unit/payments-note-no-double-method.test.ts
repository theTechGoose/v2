/**
 * REQ-1122 (LOOP-007 cycle 3, q3-50; amends REQ-960) — a /payments card must not repeat the
 * payment method when the owner's reference already starts with it. QA recorded a Check with
 * reference "Check #1042" (the Mark-paid placeholder itself says "e.g. check #1042") and the
 * card read "Check Check #1042 from Greg." (es: "Cheque Check #1042 de Greg.").
 *
 * The real `noteFor` is lifted out of front-end/islands/PaymentsPage.tsx (it is not exported),
 * along with any top-level function of that file it calls, transpiled, and run with the real
 * dictionaries. Contract the fix must keep:
 *   noteFor(lang, method, daysAgo, client, reference?) stays a top-level function in the island;
 *   any helper it needs is either a top-level function in the same file or inlined.
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
function liftFunction(name: string): string | undefined {
  const start = src.search(new RegExp(`\\n(?:export )?function ${name}\\s*[(<]`));
  if (start < 0) return undefined;
  const open = src.indexOf("{", src.indexOf(")", start));
  let i = open, depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1).replace(/^\n?export /, "\n");
}

/** noteFor plus every same-file top-level function it (transitively) calls */
function liftWithHelpers(root: string): string {
  const seen = new Map<string, string>();
  const queue = [root];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    const body = liftFunction(name);
    if (!body) {
      if (name === root) throw new Error(`${ISLAND} has no function ${root}`);
      continue;
    }
    seen.set(name, body);
    for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (m[1] !== "tFor" && !seen.has(m[1])) queue.push(m[1]);
    }
  }
  return [...seen.values()].join("\n");
}

type NoteFor = (
  lang: string,
  method: string,
  daysAgo: number,
  client: string,
  reference?: string,
) => string;

const noteFor: NoteFor = (() => {
  const js = ts.transpileModule(liftWithHelpers("noteFor"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function("tFor", `${js}\nreturn noteFor;`)(tFor) as NoteFor;
})();

const DOUBLED_CHECK = /\b(check|cheque)\.?\s+(check|cheque|chk|ck)\b/i;

describe("REQ-1122 q3-50: a /payments card never doubles the payment method", () => {
  test("REQ-1122 en: check ref 'Check #1042' reads 'Check #1042 from Greg.'", () => {
    expect(noteFor("en", "check", 0, "Greg Pruitt", "Check #1042")).toBe(
      "Check #1042 from Greg.",
    );
  });

  test("REQ-1122 en: check ref 'CHECK 1042' does not double the word", () => {
    const note = noteFor("en", "check", 0, "Greg Pruitt", "CHECK 1042");
    expect(note).not.toMatch(DOUBLED_CHECK);
    expect(note).toBe("Check 1042 from Greg.");
  });

  test("REQ-1122 en: check ref 'check #1042' (the placeholder's own wording) does not double", () => {
    const note = noteFor("en", "check", 0, "Greg Pruitt", "check #1042");
    expect(note).not.toMatch(DOUBLED_CHECK);
    expect(note).toBe("Check #1042 from Greg.");
  });

  test("REQ-1122 es: check ref 'cheque #1042' (the es placeholder) reads 'Cheque #1042 de Greg.'", () => {
    expect(noteFor("es", "check", 0, "Greg Pruitt", "cheque #1042")).toBe(
      "Cheque #1042 de Greg.",
    );
  });

  test("REQ-1122 es: check ref 'Check #1042' reads 'Cheque #1042 de Greg.'", () => {
    const note = noteFor("es", "check", 0, "Greg Pruitt", "Check #1042");
    expect(note).not.toMatch(DOUBLED_CHECK);
    expect(note).toBe("Cheque #1042 de Greg.");
  });

  for (const lang of ["en", "es"]) {
    test(`REQ-1122 ${lang}: a bare ref '1042' is kept as typed (REQ-960 still holds)`, () => {
      expect(noteFor(lang, "check", 0, "Greg Pruitt", "1042")).toBe(
        lang === "en" ? "Check 1042 from Greg." : "Cheque 1042 de Greg.",
      );
    });

    test(`REQ-1122 ${lang}: cash ref 'Cash 12' / 'Efectivo 12' does not repeat the method`, () => {
      for (const ref of ["Cash 12", "Efectivo 12"]) {
        const note = noteFor(lang, "cash", 0, "Greg Pruitt", ref);
        expect(`${ref} → ${note}`).toContain("12");
        const word = /cash|efectivo/gi;
        expect(`${ref} → ${note}: ${(note.match(word) ?? []).length}`).toBe(
          `${ref} → ${note}: 1`,
        );
      }
    });
  }
});
