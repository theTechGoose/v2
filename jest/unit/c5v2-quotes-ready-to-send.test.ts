/**
 * REQ-760 (demo-loop cycle 5v2, demo issue m14): QuotesPage feeds the hero
 * the server's per-card readiness. The verifier's /quotes said "1 draft ready
 * to send" over a drafted-only quote because QuotesPage never read it.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-760 (cycle 5v2, m14) /quotes hero uses the server's readyToSend", () => {
  const page = read("front-end/islands/QuotesPage.tsx");
  it("mapCard carries the card's readyToSend onto the Quote", () => {
    expect(page).toMatch(/readyToSend:\s*c\.readyToSend/);
  });
  it("QuotesHero gets readyCount from quotesHeroNumbers", () => {
    expect(page).toMatch(/readyCount=\{heroNums\.readyCount\}/);
  });
  it("the client type and Quote type declare readyToSend", () => {
    expect(read("front-end/clients/quotes.ts")).toMatch(/readyToSend\?: boolean/);
    expect(read("front-end/lib/quotes-seed.ts")).toMatch(/readyToSend\?: boolean/);
  });
  it("en and es both carry the in-progress hero title (one/other)", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (const k of ["quotesHero.draftsInProgressTitle.one", "quotesHero.draftsInProgressTitle.other"]) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
    }
  });
});
