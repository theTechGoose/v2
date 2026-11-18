/**
 * REQ-928 — Raphael, 2026-11-18: "when an invoice is paid, it should show the
 * method of payment and when it was paid in all views. print electronic or
 * other."
 *
 * One helper (`shared/documents/paid-how.ts`) turns the invoice's
 * `paidMethods` + `paidAt` into the line every view prints:
 * "Paid November 11, 2026 · Electronic (Venmo)" / "Other (Check)". Fed the real
 * dictionaries.
 */
import * as fs from "fs";
import * as path from "path";
import { paidHow, paidKind, paidLine, paidMethodsOf } from "../../shared/documents/paid-how";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DICTS = {
  en: JSON.parse(read("lang/en.json")) as Record<string, string>,
  es: JSON.parse(read("lang/es.json")) as Record<string, string>,
};
const tOf = (lang: "en" | "es") => (key: string, vars: Record<string, string | number> = {}) => {
  const s = DICTS[lang][key];
  if (s === undefined) throw new Error(`missing ${lang} key ${key}`);
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
};

describe("REQ-928 paid method + date", () => {
  test("REQ-928: card, ACH and the wallets are electronic; cash, check, other are other", () => {
    for (const m of ["card", "ach", "venmo", "zelle", "cashapp", "paypal"]) {
      expect(paidKind(m)).toBe("electronic");
    }
    for (const m of ["cash", "check", "other", "", undefined, "bogus"]) {
      expect(paidKind(m)).toBe("other");
    }
  });

  test("REQ-928: how it was paid names the kind and the method", () => {
    const en = tOf("en");
    expect(paidHow(en, ["venmo"])).toBe("Electronic (Venmo)");
    expect(paidHow(en, ["card"])).toBe("Electronic (Credit card)");
    expect(paidHow(en, ["cashapp"])).toBe("Electronic (Cash App)");
    expect(paidHow(en, ["check"])).toBe("Other (Check)");
    expect(paidHow(en, ["other"])).toBe("Other");
    expect(paidHow(en, ["check", "venmo"])).toBe("Other (Check) + Electronic (Venmo)");
    expect(paidHow(en, ["venmo", "venmo"])).toBe("Electronic (Venmo)");
    expect(paidHow(en, [])).toBe("");
    expect(paidHow(en, undefined)).toBe("");
    expect(paidHow(tOf("es"), ["zelle"])).toBe("Electrónico (Zelle)");
    expect(paidHow(tOf("es"), ["cash"])).toBe("Otro (Efectivo)");
  });

  test("REQ-928: the paid line carries the date and the method in both languages", () => {
    expect(paidLine(tOf("en"), "en", { paidAt: "2026-11-11T20:57:57.358Z", paidMethods: ["venmo"] }))
      .toBe("Paid November 11, 2026 · Electronic (Venmo)");
    expect(paidLine(tOf("es"), "es", { paidAt: "2026-11-11T20:57:57.358Z", paidMethods: ["check"] }))
      .toBe("Pagada el 11 de noviembre de 2026 · Otro (Cheque)");
    // a paid invoice from before REQ-928 with no recorded method still says when
    expect(paidLine(tOf("en"), "en", { paidAt: "2026-11-11", paidMethods: [] }))
      .toBe("Paid November 11, 2026");
    expect(paidLine(tOf("en"), "en", { paidMethods: ["card"] })).toBe("Paid · Electronic (Credit card)");
  });

  test("REQ-928: paidMethodsOf lists the distinct payment methods oldest first", () => {
    expect(paidMethodsOf([
      { method: "venmo", receivedAt: "2026-11-12" },
      { method: "check", receivedAt: "2026-11-01" },
      { method: "venmo", receivedAt: "2026-11-05" },
    ])).toEqual(["check", "venmo"]);
    expect(paidMethodsOf([])).toEqual([]);
  });

  // The views: each one that shows a paid invoice prints the line through the helper.
  const VIEWS: [string, RegExp][] = [
    ["front-end/islands/InvoicesPage.tsx", /paidHow\(|paidLine\(/],
    ["front-end/routes/i/[id].tsx", /paidLine\(/],
    ["front-end/components/MoneyBar.tsx", /paidHow\(/],
    ["front-end/components/quote-doc.tsx", /paidLine\(/],
    ["front-end/islands/PaymentsPage.tsx", /paidHow\(/],
    ["backend/src/paperwork/domain/coordinators/render-invoice-pdf/mod.ts", /paidLine\(/],
    ["backend/src/paperwork/domain/coordinators/render-invoice-print-pdf/mod.ts", /paidLine\(/],
    ["backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts", /paidHow\(/],
  ];
  test.each(VIEWS)("REQ-928: %s prints the paid method", (file, re) => {
    expect(read(file)).toMatch(re);
  });
});
