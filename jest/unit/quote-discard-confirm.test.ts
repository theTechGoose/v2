/**
 * REQ-693 — demo-loop cycle 5, issue p18-7a: "Discard draft" asks first.
 *
 * The REQ-395 ghost button used to call discard() directly — one click threw
 * the owner's revision away with no confirm and no undo. It now opens an
 * inline two-step like the change-order withdraw (REQ-462):
 * "Discard Version 2? Your edits are lost. [Discard] [Keep]".
 *
 *   front-end/islands/QuotesPage.tsx  quote-discard-draft → ask;
 *                                     quote-discard-confirm → discard();
 *                                     quote-discard-keep → back
 *   lang/en.json, lang/es.json        quotes.ledger.discardAsk/Confirm/Keep
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** The JSX element (opening tag through its closing tag) carrying data-cy. */
function element(src: string, cy: string): string {
  const at = src.indexOf(`data-cy="${cy}"`);
  if (at < 0) return "";
  const start = src.lastIndexOf("<button", at);
  const end = src.indexOf("</button>", at);
  return src.slice(start, end);
}

describe("REQ-693 (p18-7a) Discard draft asks before it throws the revision away", () => {
  const src = read("front-end/islands/QuotesPage.tsx");

  it("REQ-693 the ghost Discard draft button does not call discard() itself", () => {
    const ghost = element(src, "quote-discard-draft");
    expect(ghost).not.toBe("");
    expect(ghost).not.toMatch(/onClick=\{discard\}/);
    expect(ghost).not.toMatch(/discard\(\)/);
  });

  it("REQ-693 an inline ask names the version and offers Discard / Keep", () => {
    expect(src).toMatch(/quotes\.ledger\.discardAsk/);
    const ask = src.slice(src.indexOf("quotes.ledger.discardAsk"));
    expect(ask.slice(0, 120)).toMatch(/n: ledger\.quote\.version \+ 1/);
    const confirm = element(src, "quote-discard-confirm");
    expect(confirm).toMatch(/onClick=\{discard\}/);
    expect(confirm).toMatch(/quotes\.ledger\.discardConfirm/);
    const keep = element(src, "quote-discard-keep");
    expect(keep).toMatch(/quotes\.ledger\.discardKeep/);
    expect(keep).not.toMatch(/onClick=\{discard\}|discard\(\)/);
    expect(keep).toMatch(/setAskDiscard\(false\)/);
  });

  it("REQ-693 en and es carry the ask, and they differ", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["quotes.ledger.discardAsk"]).toBe(
      "Discard Version {n}? Your edits are lost.",
    );
    expect(en["quotes.ledger.discardConfirm"]).toBe("Discard");
    expect(en["quotes.ledger.discardKeep"]).toBe("Keep");
    for (
      const key of [
        "quotes.ledger.discardAsk",
        "quotes.ledger.discardConfirm",
        "quotes.ledger.discardKeep",
      ]
    ) {
      expect(typeof es[key]).toBe("string");
      expect(es[key]).not.toEqual(en[key]);
    }
    expect(es["quotes.ledger.discardAsk"]).toMatch(/\{n\}/);
  });
});
