/**
 * REQ-122 — RingCentral's TCR reviewer (case 32804924, emails of 2026-10-20/21, forwarded by
 * Hans on 2026-10-22): the policy links opened in Spanish — "submit the direct URL parameter for
 * the English view (https://documonster.com/privacy?lang=en and
 * https://documonster.com/sms-terms?lang=en)"; "If using the web form at
 * https://documonster.com/contact, please remove the phone number reference." Raphael,
 * 2026-10-27: "fix the code only fixes".
 *
 * ONE resolver of a public page's language (front-end/lib/page-lang.ts): an explicit ?lang= wins
 * and is the pick to persist, then the visitor's saved pm_lang, then Spanish — the browser's
 * Accept-Language ignored on purpose (REQ-043 amendment). /contact reads it the way the four
 * legal pages do (front-end/lib/public-page.ts, the one GET handler), the app shell labels <html>
 * with the language the page resolved, and the consent sentence names no phone number.
 */
import * as fs from "fs";
import * as path from "path";
import { resolvePageLang } from "../../front-end/lib/page-lang";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

describe("REQ-122 resolvePageLang — ?lang= wins and is the pick, then pm_lang, then Spanish; the browser's language never", () => {
  test("?lang=en with no cookie is English, and the pick to persist", () => {
    expect(resolvePageLang(req("http://x/contact?lang=en"))).toEqual({ lang: "en", picked: "en" });
  });

  test("?lang=es over a saved English choice is Spanish, and the pick", () => {
    expect(resolvePageLang(req("http://x/contact?lang=es", { cookie: "pm_lang=en" }))).toEqual({ lang: "es", picked: "es" });
  });

  test("no ?lang=: the saved pm_lang, nothing to persist — also when HTTP/2 comma-joined the cookies", () => {
    expect(resolvePageLang(req("http://x/contact", { cookie: "pm_session=abc; pm_lang=en" }))).toEqual({ lang: "en", picked: null });
    expect(resolvePageLang(req("http://x/privacy", { cookie: "pm_session=abc, pm_lang=en" }))).toEqual({ lang: "en", picked: null });
  });

  test("neither: Spanish-first, whatever the browser asks for (REQ-043 amendment)", () => {
    expect(resolvePageLang(req("http://x/contact", { "accept-language": "en-US,en;q=0.9" }))).toEqual({ lang: "es", picked: null });
    expect(resolvePageLang(req("http://x/sms-terms"))).toEqual({ lang: "es", picked: null });
  });

  test("a ?lang= that is no language falls through", () => {
    expect(resolvePageLang(req("http://x/contact?lang=fr", { cookie: "pm_lang=en" }))).toEqual({ lang: "en", picked: null });
    expect(resolvePageLang(req("http://x/contact?lang="))).toEqual({ lang: "es", picked: null });
  });
});

describe("REQ-122 /contact is a public page like the four legal pages, and its consent sentence names no phone number", () => {
  test("both dictionaries: Reply HELP for assistance — STOP, rates and frequency kept — no number, no {phone} placeholder", () => {
    expect(en["contactPage.smsConsent"]).toContain(
      "You may reply STOP to opt out at any time. Reply HELP for assistance. Messages and data rates may apply. Message frequency will vary.",
    );
    expect(es["contactPage.smsConsent"]).toContain(
      "Puede responder STOP en cualquier momento para darse de baja. Responda HELP para obtener ayuda. Pueden aplicarse tarifas de mensajes y datos. La frecuencia de los mensajes variará.",
    );
    for (const dict of [en, es]) {
      expect(dict["contactPage.smsConsent"]).not.toMatch(/\{phone\}/);
      expect(dict["contactPage.smsConsent"]).not.toMatch(/\d/);
    }
  });

  test("the contact route is the public page handler — ?lang= honored and persisted — and hands the consent sentence no phone", () => {
    const src = read("front-end/routes/contact.tsx");
    expect(src).toMatch(/import \{ publicPageHandler \} from "\.\.\/lib\/public-page\.ts"/);
    expect(src).toMatch(/export const handler = publicPageHandler/);
    expect(src).toMatch(/ctx\.data\.lang/);
    expect(src).not.toMatch(/pickLangFromAcceptLanguage|langFromCookie/);
    expect(src).not.toMatch(/"contactPage\.smsConsent",\s*\{/);
  });

  test("the four legal pages read the same handler (REQ-066), and the legal-only module is gone (REQ-281)", () => {
    for (const route of ["terms", "refund-policy", "privacy", "sms-terms"]) {
      const src = read(`front-end/routes/${route}.tsx`);
      expect(src).toMatch(/import \{ publicPageHandler \} from "\.\.\/lib\/public-page\.ts"/);
      expect(src).toMatch(/export const handler = publicPageHandler/);
    }
    expect(fs.existsSync(path.join(ROOT, "front-end/lib/legal-page.ts"))).toBe(false);
  });

  test("the app shell labels <html> with the language the page resolved, before its own guess", () => {
    // the expression, not a comment: the page's language is the first thing the shell asks
    expect(read("front-end/routes/_app.tsx")).toMatch(/const lang: Lang = ctx\.state\.lang \?\?/);
    expect(read("front-end/utils.ts")).toMatch(/lang\?: Lang/);
  });
});
