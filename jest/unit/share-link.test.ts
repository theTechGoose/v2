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
const base = "https://documonster.com";

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

// REQ-342 (demo-loop cycle 1, M13): the send language rides on every link
// the customer receives, so a cookie-less visitor opens the document in the
// language it was sent in (REQ-048: "?lang= on the link" is the visitor's pick).
describe("REQ-342 share links carry the send language", () => {
  it("the short link carries ?lang= when a send language is given", () => {
    expect(quoteShareLink(quote, base, "es")).toBe(
      `${base}/s/${quote.shortCode}?lang=es`,
    );
  });

  it("a quote without a short code links /q/<id>?lang=", () => {
    expect(quoteShareLink({ id: quote.id }, base, "es")).toBe(
      `${base}/q/${quote.id}?lang=es`,
    );
  });

  it("view-as-client carries ?lang= too", () => {
    expect(quoteClientViewLink(quote, base, "en")).toBe(
      `${base}/q/${quote.id}?lang=en`,
    );
  });

  it("the /s redirect target forwards the link's lang onto /q", () => {
    expect(resolveShareTarget(quote, "es")).toBe(`/q/${quote.id}?lang=es`);
  });

  it("no send language → the links are unchanged (REQ-048 English first)", () => {
    expect(quoteShareLink(quote, base)).toBe(`${base}/s/${quote.shortCode}`);
    expect(quoteClientViewLink(quote, base)).toBe(`${base}/q/${quote.id}`);
    expect(resolveShareTarget(quote)).toBe(`/q/${quote.id}`);
    expect(resolveShareTarget(quote, "fr")).toBe(`/q/${quote.id}`);
  });
});
