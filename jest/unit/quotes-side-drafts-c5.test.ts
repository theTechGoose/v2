/**
 * REQ-740 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue p18-5b: the /quotes side
 * card read "Top of the pipeline — No open quotes yet." right next to a draft
 * the user could see.
 *
 * RCA (analyst CONFIRMED, skeptic UPHELD, at 2444608a): QuotesPage renders
 * `<QSideBig open={out}>` — the sent quotes only, drafts excluded on purpose —
 * and an empty list prints quotesSide.topEmpty, which never mentions drafts.
 * Fix: pass the draft count, as QuotesAwaiting does (REQ-404), and say the
 * draft has to be sent to show up here.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { quotesSideTopEmpty } from "../../front-end/lib/headline-counts";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-740 (cycle 5, p18-5b): the 'Top of the pipeline' empty line mentions drafts", () => {
  it("REQ-740 no drafts → the old 'No open quotes yet' line", () => {
    expect(quotesSideTopEmpty(0)).toEqual({ key: "quotesSide.topEmpty", n: 0 });
  });
  it("REQ-740 one draft → the singular drafts line; several → the plural", () => {
    expect(quotesSideTopEmpty(1))
      .toEqual({ key: "quotesSide.topEmptyDrafts.one", n: 1 });
    expect(quotesSideTopEmpty(3))
      .toEqual({ key: "quotesSide.topEmptyDrafts.other", n: 3 });
  });
  it("REQ-740 en + es say nothing is sent yet and to send the draft", () => {
    expect(en["quotesSide.topEmptyDrafts.one"]).toBe(
      "No sent quotes yet — send your draft to see it here.",
    );
    expect(en["quotesSide.topEmptyDrafts.other"]).toBe(
      "No sent quotes yet — send your drafts to see them here.",
    );
    expect(es["quotesSide.topEmptyDrafts.one"]).toBe(
      "Aún no hay cotizaciones enviadas — envía tu borrador para verlo aquí.",
    );
    expect(es["quotesSide.topEmptyDrafts.other"]).toBe(
      "Aún no hay cotizaciones enviadas — envía tus borradores para verlos aquí.",
    );
  });
  it("REQ-740 QuotesPage passes the real draft count to QSideBig, and QSideBig picks its line through quotesSideTopEmpty", () => {
    expect(read("front-end/islands/QuotesPage.tsx")).toMatch(
      /<QSideBig\s+open=\{out\}\s+draftCount=\{drafts\.length\}/,
    );
    const src = read("front-end/components/QuotesSections.tsx");
    const big = src.slice(
      src.indexOf("export function QSideBig"),
      src.indexOf("interface QSideRateProps"),
    );
    expect(big).toMatch(/quotesSideTopEmpty\(draftCount\)/);
    expect(big).not.toMatch(/tFor\(lang, "quotesSide\.topEmpty"\)/);
  });
});
