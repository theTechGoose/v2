/**
 * REQ-972 — LOOP-007 cycle 1, issue q1-52: the product's word for the document
 * is Quote / Cotización (nav.quotes = "Quotes & agreements" / "Cotizaciones y
 * acuerdos", and the money bar's estimates bucket links to /quotes). The money
 * bar's sent-quotes caption said "{n} estimate(s) out" / "{n} presupuesto(s)
 * enviado(s)" (REQ-798, 08b4524a) and the onboarding insurance "why" said
 * "...to your bids" / "...a tus propuestas" (REQ-227, 3808f6ef).
 *
 * This guard pins the four strings to the product's word and fails on any
 * Spanish UI string that calls a quote a "presupuesto" or a "propuesta"
 * (the allow-list keeps the "budget" meanings, a proposed change-order
 * invoice and the landing pricing feature).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-972 (q1-52) quotes are called Quote / Cotización everywhere", () => {
  test("REQ-972 en: the money bar's sent-quotes caption says 'quote out', not 'estimate'", () => {
    expect(en["moneyBar.bucket.estimates.one"]).toBe("{n} quote out");
    expect(en["moneyBar.bucket.estimates.other"]).toBe("{n} quotes out");
  });

  test("REQ-972 es: the money bar's sent-quotes caption says 'cotización enviada', not 'presupuesto'", () => {
    expect(es["moneyBar.bucket.estimates.one"]).toBe("{n} cotización enviada");
    expect(es["moneyBar.bucket.estimates.other"]).toBe(
      "{n} cotizaciones enviadas",
    );
  });

  test("REQ-972 en: the onboarding insurance 'why' says 'quotes', not 'bids'", () => {
    const why = en["welcome.insurance.why"];
    expect(why).toMatch(/\bquotes\b/);
    expect(why).not.toMatch(/\bbids?\b|\bestimates?\b/i);
  });

  test("REQ-972 es: the onboarding insurance 'why' says 'cotizaciones', not 'propuestas'", () => {
    const why = es["welcome.insurance.why"];
    expect(why).toMatch(/cotizaciones/);
    expect(why).not.toMatch(/propuestas?|presupuestos?/i);
  });

  // keys where the word is NOT a quote: "budget", a proposed invoice, the landing pricing tier
  const ALLOW = new Set([
    "changeOrderPublic.thisInvoiceProposed", // "Esta factura, propuesta" (a proposed invoice)
    "clientsSeed.bayside.story.line", // "aprieta el presupuesto" = budget
    "publicQuoteActions.declineForm.notePlaceholder", // "el presupuesto fue menor" = budget
    "quotesSeed.story.q1104", // "aprieta el presupuesto" = budget
    "landing.price.t4.f2", // landing pricing feature list
  ]);

  test("REQ-972 es: no UI string calls a quote a 'presupuesto' or a 'propuesta'", () => {
    const offenders = Object.entries(es)
      .filter(([k]) => !k.startsWith("prompts."))
      .filter(([k]) => !ALLOW.has(k))
      .filter(([, v]) => /\b(presupuestos?|propuestas?)\b/i.test(v))
      .map(([k, v]) => `${k}: ${v}`);
    expect(offenders).toEqual([]);
  });
});
