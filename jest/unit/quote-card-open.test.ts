/**
 * REQ-239 (demo issue M28) — a quote card in "Out for response" or
 * "Drafting" opens the quote panel from /quotes, the same way a decided row
 * does. Before: QuotesPage passed `onOpen={openQuote}` to DecidedRow only,
 * QuoteCard had no `onOpen` prop and no Open action, so the REQ-201/205
 * panel (ledger, versions, Publish revision) was reachable only by typing
 * `?open=<id>` into the address bar.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-239 (M28) a pipeline quote card opens the quote panel", () => {
  const card = read("front-end/islands/QuoteCard.tsx");
  const page = read("front-end/islands/QuotesPage.tsx");

  test("REQ-239 QuoteCard takes an onOpen(id) prop", () => {
    expect(card).toMatch(/onOpen\?:\s*\(id: string\) => void/);
  });

  test("REQ-239 the card's back carries ONE primary Open button that calls onOpen(q.id)", () => {
    const back = card.slice(card.indexOf('class="qcard__back-foot"'));
    expect(back).toContain('data-cy="qcard-open"');
    const at = back.indexOf('data-cy="qcard-open"');
    const btn = back.slice(
      back.lastIndexOf("<button", at),
      back.indexOf("</button>", at),
    );
    expect(btn).toMatch(/onOpen\(q\.id\)/);
    expect(btn).toContain("qcard__back-btn--primary");
    expect(btn).toContain('"quoteCard.back.open"');
    // exactly one solid primary in the back footer (owner's action-row rule)
    expect(back.split("qcard__back-btn--primary").length - 1).toBe(1);
  });

  test("REQ-239 both pipeline tracks hand openQuote to their QuoteCards", () => {
    const cards = page.split("<QuoteCard").slice(1).map((s) =>
      s.slice(0, s.indexOf("/>"))
    );
    expect(cards.length).toBe(2);
    for (const c of cards) expect(c).toMatch(/onOpen=\{openQuote\}/);
  });

  test("REQ-239 the Open label exists in both languages", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["quoteCard.back.open"]).toBe("Open quote");
    expect(es["quoteCard.back.open"]).toBe("Abrir cotización");
  });
});
