/**
 * REQ-313 (demo-loop cycle 1, issue m48) — the /quotes pipeline card carries
 * the quote's own number. The backend card DTO (`QuoteCard extends Quote
 * extends NumberedFields`) already carries `number` and `version`; the
 * front-end's mapCard dropped them on the floor. This pins the hand-off so the
 * island (tested by front-end/lib/quote-card-number.test.tsx) actually gets
 * them.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-313 (m48) the quote number reaches the pipeline card", () => {
  test("REQ-313 the front-end Quote shape has number and version", () => {
    const seed = read("front-end/lib/quotes-seed.ts");
    const iface = seed.slice(
      seed.indexOf("export interface Quote {"),
      seed.indexOf("}", seed.indexOf("export interface Quote {")),
    );
    expect(iface).toMatch(/number\?: string;/);
    expect(iface).toMatch(/version\?: number;/);
  });

  test("REQ-313 mapCard passes the backend card's number and version through", () => {
    const page = read("front-end/islands/QuotesPage.tsx");
    const fn = page.slice(
      page.indexOf("function mapCard("),
      page.indexOf("\n}\n", page.indexOf("function mapCard(")),
    );
    expect(fn).toMatch(/number:\s*c\.number/);
    expect(fn).toMatch(/version:\s*c\.version/);
  });

  test("REQ-313 the card never renders the positional 01/02 numeral as if it were the number", () => {
    const card = read("front-end/islands/QuoteCard.tsx");
    expect(card).toMatch(/q\.number/);
  });
});
