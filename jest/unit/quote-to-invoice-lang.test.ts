/**
 * REQ-492 — demo-loop cycle 3, issue M29: "Public invoice switches EN→ES
 * when the client clicks Pay from an English quote".
 *
 * Root cause (RCA at cc5d4b0e): /q is English-first (resolveContractLang:
 * ?lang= → pm_lang → "en") while /i falls through to the contractor's
 * commsLanguage (resolvePublicLang). The /q → /i hand-off (payNowTarget's
 * url, the related-document rows) carried no ?lang=, so a fresh browser left
 * an English quote for a Spanish invoice. The fix: every hand-off link out of
 * the quote carries the page's language via withLang(url, lang).
 */
import * as fs from "fs";
import * as path from "path";
import { withLang } from "../../shared/quote-flow/public-lang";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-492 withLang — a hand-off link carries the reader's language", () => {
  it("REQ-492 adds ?lang= to a bare relative path", () => {
    expect(withLang("/i/inv-1", "en")).toBe("/i/inv-1?lang=en");
    expect(withLang("/co/co-1", "es")).toBe("/co/co-1?lang=es");
  });

  it("REQ-492 keeps other query params and replaces an existing lang", () => {
    expect(withLang("/i/inv-1?ref=sms&lang=es", "en"))
      .toBe("/i/inv-1?ref=sms&lang=en");
  });

  it("REQ-492 keeps the hash", () => {
    expect(withLang("/i/inv-1#pay", "en")).toBe("/i/inv-1?lang=en#pay");
  });

  it("REQ-492 keeps an absolute url absolute (same host, same path)", () => {
    expect(withLang("https://documonster.com/i/inv-1", "es"))
      .toBe("https://documonster.com/i/inv-1?lang=es");
  });
});

describe("REQ-492 quote-doc.tsx wires every /q → /i, /co hand-off through withLang", () => {
  const doc = read("front-end/components/quote-doc.tsx");

  it("REQ-492 no anchor links payNow.url or a related row's url raw", () => {
    expect(doc).not.toMatch(/href=\{payNow\.url\}/);
    expect(doc).not.toMatch(/href=\{r\.url\}/);
  });

  it("REQ-492 Pay now (both anchors) and the related rows use withLang(…, lang)", () => {
    expect(doc.match(/href=\{withLang\(payNow\.url, lang\)\}/g)?.length)
      .toBe(2);
    expect(doc).toMatch(/href=\{withLang\(r\.url, lang\)\}/);
  });
});
