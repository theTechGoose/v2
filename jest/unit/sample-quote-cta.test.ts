/**
 * REQ-614 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue m16: "Onboarding sample quote sits in the
 * pipeline with 'Finish + send'".
 *
 * The card's front CTA is covered by front-end/lib/sample-quote-cta.test.tsx
 * (renders the island). This pins the rest: the copy exists in both
 * languages, and the quote panel opened for a sample (the card's back "Open
 * quote") offers nothing that sends or shares it — no Copy link (REQ-360
 * already took it off the card's back), no Edit (canReviseQuote).
 */
import * as fs from "fs";
import * as path from "path";
import { canReviseQuote } from "../../front-end/lib/quote-line-edit";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-614 (cycle 4, m16) the onboarding sample is never offered for sending", () => {
  test("REQ-614 'View sample' copy exists in en and es", () => {
    expect(en["quoteCard.cta.viewSample"]).toBe("View sample");
    expect(es["quoteCard.cta.viewSample"]).toBe("Ver muestra");
  });

  test("REQ-614 the sample panel has a sample note in en and es", () => {
    expect(en["quotesPage.open.sampleNote"]).toBeTruthy();
    expect(es["quotesPage.open.sampleNote"]).toBeTruthy();
  });

  test("REQ-614 the quote panel's Copy link is gated on !isSample", () => {
    const page = read("front-end/islands/QuotesPage.tsx");
    const panel = page.slice(
      page.indexOf("function OpenQuotePanel("),
      page.indexOf("const INITIAL: State"),
    );
    const at = panel.indexOf('"quotesPage.open.copyLink"');
    expect(at).toBeGreaterThan(-1);
    const before = panel.slice(panel.lastIndexOf("<button", at) - 80, at);
    expect(before).toMatch(/!q\.isSample\s*&&/);
    expect(panel).toContain('"quotesPage.open.sampleNote"');
  });

  test("REQ-614 the sample panel offers no Edit (revise) either", () => {
    expect(canReviseQuote({ status: "draft", isSample: true })).toBe(false);
  });
});
