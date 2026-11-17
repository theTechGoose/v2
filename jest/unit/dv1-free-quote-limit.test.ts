/**
 * REQ-778 (demo-loop cycle dv1, issue d8 "Free plan: five quotes a month, enforced and stated").
 * Raphael: "The free plan limit is five quotes." The pricing page says "up to five quotes a month"
 * for Free; the sixth quote is refused with a message naming the limit and how to upgrade, on the
 * New quote path (the assistant's wizard POST /quotes → 402) and in the chat (REQ-766).
 */
import * as fs from "fs";
import * as path from "path";
import { planById, planFeatures } from "../../shared/quote-flow/pricing-plans";
import { LANDING_DICT } from "../../front-end/lib/landing-dict";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-778 dv1 d8: Monster Free is five quotes a month, stated and enforced", () => {
  it("the Free card says 'Up to five quotes a month' (en) and 'Hasta cinco cotizaciones al mes' (es)", () => {
    expect(planFeatures("free", "en")).toContain("Up to five quotes a month");
    expect(planFeatures("free", "es")).toContain("Hasta cinco cotizaciones al mes");
    expect(planById("free").limits).toEqual({ quotesPerMonth: 5 });
  });

  it("the pricing page's Free blurb says it, in both languages", () => {
    expect(planById("free").blurb).toMatch(/Up to five quotes a month\./);
    expect(LANDING_DICT.en["price.t1.blurb"]).toMatch(/Up to five quotes a month\./);
    expect(LANDING_DICT.es["price.t1.blurb"]).toMatch(/Hasta cinco cotizaciones al mes\./);
  });

  it("the limit message is in en and es, names the limit and the place to upgrade", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["quoteLimit.message"]).toMatch(/\{limit\} quotes for this month on Monster Free.*Settings → Billing/);
    expect(es["quoteLimit.message"]).toMatch(/\{limit\} cotizaciones de este mes en Monster Free.*Configuración → Facturación/);
    expect(typeof en["quoteLimit.upgrade"]).toBe("string");
    expect(typeof es["quoteLimit.upgrade"]).toBe("string");
    // the chat's reply (REQ-766) names the tab that exists: Billing, not "Plan"
    expect(en["chatCoordinator.quoteLimit"]).toMatch(/Settings → Billing/);
    expect(es["chatCoordinator.quoteLimit"]).toMatch(/Configuración → Facturación/);
  });

  it("the assistant's New quote wizard shows the limit message when POST /quotes is refused", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const start = src.indexOf("async function startQuoteFromRaw");
    const body = src.slice(start, src.indexOf("function applyJobOption", start));
    expect(body).toMatch(/quoteLimitFromError\(err\)/);
    expect(body).toMatch(/quoteLimitMessage\(lang, /);
  });
});
