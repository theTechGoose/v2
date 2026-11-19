/**
 * REQ-937 (LOOP-007 cycle 1, issue q1-4): "Publish revision" re-sent a
 * Spanish customer's quote in English. The /quotes ledger's publish() sent
 * `language: lang` — the owner's UI language — and the backend treats
 * `language` as a per-send pick that beats everything else. Version 1 went
 * out in Español (quote.lastDelivery.lang = "es"); Version 2 must too.
 *
 * `publishLanguage(quote, pick?)` is the language the panel's publish asks
 * for: an explicit pick, else the language the quote last went out in, else
 * nothing (the backend resolves the customer's language / account default).
 * It never takes the UI language.
 */
import * as fs from "fs";
import * as path from "path";
import * as panelSend from "../../front-end/lib/quote-panel-send.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

type PublishLanguage = (
  q: { lastDelivery?: { lang?: string } | null },
  pick?: "en" | "es",
) => "en" | "es" | undefined;
const publishLanguage = (panelSend as unknown as {
  publishLanguage?: PublishLanguage;
}).publishLanguage;

describe("REQ-937 (LOOP-007 q1-4) publishLanguage: a published revision goes out in the language the quote last went out in", () => {
  it("REQ-937 is exported from front-end/lib/quote-panel-send.ts", () => {
    expect(typeof publishLanguage).toBe("function");
  });

  it("REQ-937 lastDelivery.lang 'es' with no pick → 'es' (whatever the owner's UI language is)", () => {
    expect(publishLanguage?.({ lastDelivery: { lang: "es" } })).toBe("es");
  });

  it("REQ-937 an explicit per-send pick wins over the last send language", () => {
    expect(publishLanguage?.({ lastDelivery: { lang: "es" } }, "en")).toBe(
      "en",
    );
  });

  it("REQ-937 never sent, no pick → undefined (the backend resolves the customer's language)", () => {
    expect(publishLanguage?.({})).toBeUndefined();
    expect(publishLanguage?.({ lastDelivery: null })).toBeUndefined();
    expect(publishLanguage?.({ lastDelivery: { lang: "fr" } }))
      .toBeUndefined();
  });
});

describe("REQ-937 (LOOP-007 q1-4) QuotesPage publish() never sends the UI language as the per-send pick", () => {
  it("REQ-937 the ledger's quotesClient.publish call does not pass `language: lang`", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    const call = src.match(/quotesClient\.publish\(\s*q\.id,\s*\{[^}]*\}/);
    expect(call).not.toBeNull();
    expect(call![0]).not.toMatch(/language:\s*lang\b/);
  });
});
