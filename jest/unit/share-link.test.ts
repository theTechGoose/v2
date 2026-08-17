/**
 * PDF p11 — "When selecting Copy Link from this page it is not the full
 * Quote. It is a simple version of it." Copy Link must hand the customer the
 * SAME full quote document that "View as client" shows.
 *
 * (The rendered-content proof lives in quotes-copy-link.cy.ts; this unit
 * pins that both links RESOLVE to the same document route.)
 * Target: shared/quote-flow/share-link.ts
 */
import {
  quoteClientViewLink,
  quoteShareLink,
  resolveShareTarget,
} from "../../shared/quote-flow/share-link";

const quote = { id: "2cc3b5c9", shortCode: "umn591" };
const base = "https://paperworkmonster.com";

describe("quote share links", () => {
  it("uses the public short-link format for SMS friendliness", () => {
    expect(quoteShareLink(quote, base)).toBe(`${base}/s/${quote.shortCode}`);
  });

  it("view-as-client targets the full public quote document", () => {
    expect(quoteClientViewLink(quote, base)).toBe(`${base}/q/${quote.id}`);
  });

  it("the share link RESOLVES to the same document as view-as-client — not a simplified variant", () => {
    // resolveShareTarget expands /s/<code> to its destination path.
    expect(resolveShareTarget(quote)).toBe(`/q/${quote.id}`);
  });
});
