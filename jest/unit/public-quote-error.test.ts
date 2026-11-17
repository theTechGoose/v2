/**
 * REQ-574 (demo-loop cycle 4, issue p4-p9b) — /q/<id> told a visitor whose
 * link never existed (a truncated or unknown id → 404 not_found) that "This
 * quote link expired or was revoked." PublicQuoteView mapped EVERY non-OK
 * response and every fetch failure to publicQuote.linkExpired, and with no
 * document there was no doc language, so the page fell back to English.
 *
 * Required:
 *   - 404 (and any other 4xx but 410) → "We can't find this quote — check
 *     the link." (publicQuote.notFound)
 *   - 410 (gone / revoked)            → publicQuote.linkExpired
 *   - network failure / 5xx           → "Couldn't load this quote." + a
 *     Retry button (publicQuote.loadFailed / publicQuote.retry)
 *   - with no document, the error card speaks the visitor's language:
 *     ?lang= → pm_lang cookie → Accept-Language → en.
 */
import * as fs from "fs";
import * as path from "path";
import {
  publicQuoteErrorKey,
  publicQuoteErrorOf,
} from "../../shared/quote-flow/public-quote-error";
import { resolvePublicLang } from "../../shared/quote-flow/public-lang";

const root = path.join(__dirname, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-574 p4-p9b: /q error copy matches what went wrong", () => {
  test("REQ-574 a 404 (unknown / truncated id) is 'not found', not 'expired'", () => {
    expect(publicQuoteErrorOf(404)).toBe("notFound");
    expect(publicQuoteErrorKey("notFound")).toBe("publicQuote.notFound");
    expect(publicQuoteErrorOf(400)).toBe("notFound");
  });

  test("REQ-574 only a 410 says the link expired or was revoked", () => {
    expect(publicQuoteErrorOf(410)).toBe("linkExpired");
    expect(publicQuoteErrorKey("linkExpired")).toBe("publicQuote.linkExpired");
  });

  test("REQ-574 a network failure or a 5xx is 'couldn't load — retry'", () => {
    expect(publicQuoteErrorOf(null)).toBe("loadFailed");
    expect(publicQuoteErrorOf(500)).toBe("loadFailed");
    expect(publicQuoteErrorOf(502)).toBe("loadFailed");
    expect(publicQuoteErrorKey("loadFailed")).toBe("publicQuote.loadFailed");
  });

  test("REQ-574 en + es carry the three messages and the retry label", () => {
    expect(en["publicQuote.notFound"]).toBe(
      "We can't find this quote — check the link.",
    );
    expect(en["publicQuote.loadFailed"]).toBe(
      "Couldn't load this quote. Check your connection and try again.",
    );
    expect(en["publicQuote.retry"]).toBe("Retry");
    expect(es["publicQuote.notFound"]).toBe(
      "No encontramos esta cotización — revisa el enlace.",
    );
    expect(es["publicQuote.loadFailed"]).toBe(
      "No se pudo cargar esta cotización. Revisa tu conexión e inténtalo de nuevo.",
    );
    expect(es["publicQuote.retry"]).toBe("Reintentar");
    expect(en["publicQuote.notFound"]).not.toMatch(/expired|revoked/i);
  });

  test("REQ-574 the island branches on the status instead of one LINK_GONE", () => {
    const src = read("front-end/islands/PublicQuoteView.tsx");
    expect(src).not.toMatch(/LINK_GONE/);
    expect(src).toMatch(/publicQuoteErrorOf\(r\.status\)/);
    expect(src).toMatch(/publicQuoteErrorOf\(null\)/);
    expect(src).toMatch(/onRetry=\{s\.error === "loadFailed"/);
    const card = read("front-end/components/quote-doc.tsx");
    expect(card).toMatch(/publicQuote\.retry/);
  });

  test("REQ-574 with no document the error speaks the visitor's Accept-Language", () => {
    expect(resolvePublicLang({ header: "es-MX,es;q=0.9" })).toBe("es");
    const route = read("front-end/routes/q/[id].tsx");
    expect(route).toMatch(/accept-language/);
    expect(route).toMatch(/errorLang=\{/);
    const src = read("front-end/islands/PublicQuoteView.tsx");
    expect(src).toMatch(/errorLang/);
  });
});
