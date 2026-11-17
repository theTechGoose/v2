/**
 * REQ-247 — demo issue quote-invoice-money-m8: the out-for-payment invoice card read
 * "Payment received → →". The card's front button renders `{cta}` and then its own animated
 * arrow span, so the stage CTA strings must carry no arrow of their own.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const src = read("front-end/islands/InvoicesPage.tsx");

const ARROW = /[→➜➔⟶]\s*$/;
const ctaKeys = (dict: Record<string, string>) =>
  Object.keys(dict).filter((k) => k.startsWith("invoicesPage.cta."));

describe("REQ-247 (demo quote-invoice-money-m8) the invoice card CTA shows one arrow", () => {
  test("the front button appends its own arrow after {cta}", () => {
    expect(src).toMatch(
      /\{busy \? "…" : cta\}\{" "\}\s*<span[^>]*>→<\/span>/,
    );
  });

  for (const [lang, dict] of [["en", en], ["es", es]] as const) {
    test(`no invoicesPage.cta.* value in ${lang} ends in an arrow`, () => {
      const keys = ctaKeys(dict);
      expect(keys).toContain("invoicesPage.cta.outReceived");
      const arrowed = keys.filter((k) => ARROW.test(dict[k]));
      expect(arrowed).toEqual([]);
    });

    test(`the out-for-payment front button reads exactly one arrow in ${lang}`, () => {
      const front = `${dict["invoicesPage.cta.outReceived"]} →`;
      expect((front.match(/→/g) ?? []).length).toBe(1);
    });
  }

  test("the card back no longer has to strip a trailing arrow from the CTA", () => {
    expect(src).not.toMatch(/cta\.replace\(\/ →\$\//);
  });
});
