/**
 * REQ-597 — demo-loop cycle 4, issue p4-p9a: the "send a reminder anyway?"
 * confirm on a claimed invoice read "Ana dice que pagó por por Zelle" /
 * "Ana says they paid via via Zelle". `invoicesPage.back.nudgeClaimedAsk`
 * carried a preposition, and so does every `invoicesPage.method.*` label
 * that InvoicesPage.tsx's methodLabel() fills into {method}. The template
 * now leaves the preposition to the method label.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DICTS: Record<string, Record<string, string>> = {
  en: JSON.parse(read("lang/en.json")),
  es: JSON.parse(read("lang/es.json")),
};

/** Same interpolation as front-end/lib/i18n.ts. */
const fill = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));

/** The methods methodLabel() in front-end/islands/InvoicesPage.tsx maps. */
const METHOD_KEYS = [
  "check",
  "venmo",
  "zelle",
  "cashApp",
  "paypal",
  "cash",
  "ach",
  "card",
  "other",
];

const PREPOSITIONS: Record<string, string[]> = {
  en: ["via", "by", "in", "with"],
  es: ["por", "con", "en"],
};

describe("REQ-597 (demo cycle 4, p4-p9a) the claimed-payment reminder confirm names the method once", () => {
  test("REQ-597 methodLabel() still maps exactly these method keys", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    const fn = src.slice(src.indexOf("function methodLabel("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    const used = [...body.matchAll(/invoicesPage\.method\.(\w+)/g)].map((m) =>
      m[1]
    );
    expect(used.sort()).toEqual([...METHOD_KEYS].sort());
    expect(src).toMatch(
      /"invoicesPage\.back\.nudgeClaimedAsk",\s*\{[^}]*method: methodLabel\(/,
    );
  });

  for (const lang of ["en", "es"]) {
    for (const m of METHOD_KEYS) {
      test(`REQ-597 ${lang} ${m}: no doubled preposition`, () => {
        const d = DICTS[lang];
        const label = d[`invoicesPage.method.${m}`];
        expect(label).toBeTruthy();
        const out = fill(d["invoicesPage.back.nudgeClaimedAsk"], {
          name: "Ana",
          method: label,
          ref: "",
        });
        expect(out).toContain(label);
        expect(out).not.toMatch(/\{\w+\}/);
        const words = out.toLowerCase().split(/[\s.,¿?]+/).filter(Boolean);
        for (let i = 1; i < words.length; i++) {
          expect(`${words[i - 1]} ${words[i]}`).not.toBe(
            `${words[i]} ${words[i]}`,
          );
        }
        // Two prepositions back to back ("via by", "por con") is the same bug.
        const preps = PREPOSITIONS[lang];
        for (let i = 1; i < words.length; i++) {
          const pair = `${words[i - 1]} ${words[i]}`;
          expect(
            preps.includes(words[i - 1]) && preps.includes(words[i])
              ? pair
              : "ok",
          ).toBe("ok");
        }
      });
    }
  }

  test("REQ-597 the exact Zelle sentences", () => {
    const zelle = (lang: string) =>
      fill(DICTS[lang]["invoicesPage.back.nudgeClaimedAsk"], {
        name: "Ana",
        method: DICTS[lang]["invoicesPage.method.zelle"],
        ref: "",
      });
    expect(zelle("en")).toBe(
      "Ana says they paid via Zelle. Send a payment reminder anyway?",
    );
    expect(zelle("es")).toBe(
      "Ana dice que pagó por Zelle. ¿Enviar un recordatorio de pago de todos modos?",
    );
  });
});
