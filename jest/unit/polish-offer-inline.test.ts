/**
 * REQ-384 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 2 (run r561db6d4), issue m16: "'Professionalize'
 * popup hides the line it rewrites and does little".
 *
 * Cause (RCA at deb85b35, analyst CONFIRMED + skeptic UPHELD): after a bullet
 * edit / add, the picker opened `.chat__pro-pop` — a `position: fixed;
 * inset: 0` dimmed modal (assistant-page.css, added 66b7aacf) that covered
 * the very line it offered to rewrite, asked "Want me to professionalize
 * that?" without quoting the line, and on Yes applied whatever came back —
 * for an already-clean bullet that was the same text, so Yes "did little".
 *
 * Rule now (shared/quote-flow/polish-offer.ts, `polishOffer`): the polish is
 * fetched first and offered INLINE, in the card's own list right under the
 * bullet, as a before → after preview; when the result is the same wording
 * (case, spacing and trailing punctuation aside) nothing is offered.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { polishOffer, sameWording } from "../../shared/quote-flow/polish-offer";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("REQ-384 m16: polishOffer — offer only a real rewrite, with a before/after", () => {
  it("REQ-384 a real rewrite is offered with the line it rewrites and the result", () => {
    expect(polishOffer("fix the gate", ["Repair of the gate"])).toEqual({
      before: "fix the gate",
      after: ["Repair of the gate"],
    });
  });

  it("REQ-384 an 'A + B' split is a real change even when the words are kept", () => {
    expect(
      polishOffer("4 recessed lights + City of Austin permit", [
        "4 recessed lights",
        "City of Austin permit",
      ]),
    ).toEqual({
      before: "4 recessed lights + City of Austin permit",
      after: ["4 recessed lights", "City of Austin permit"],
    });
  });

  it("REQ-384 an already-clean line (same wording back) gets no offer", () => {
    expect(
      polishOffer("Frameless glass shower door", [
        "Frameless glass shower door",
      ]),
    ).toBeNull();
    // case, spacing and a trailing period are not a rewrite
    expect(
      polishOffer("frameless  glass shower door", [
        "Frameless glass shower door.",
      ]),
    ).toBeNull();
  });

  it("REQ-384 an empty / missing result gets no offer", () => {
    expect(polishOffer("fix the gate", [])).toBeNull();
    expect(polishOffer("fix the gate", ["  ", ""])).toBeNull();
  });

  it("REQ-384 the result's lines are trimmed and blank ones dropped", () => {
    expect(polishOffer("fix gate", ["  Repair of the gate  ", " "]))
      .toEqual({ before: "fix gate", after: ["Repair of the gate"] });
  });

  it("REQ-384 sameWording ignores case, spacing and trailing punctuation only", () => {
    expect(sameWording("Paint fence.", "paint   fence")).toBe(true);
    expect(sameWording("Paint fence", "Painting of the fence")).toBe(false);
  });
});

describe("REQ-384 m16: the offer is inline under the bullet, not a covering modal", () => {
  const island = read("front-end/islands/AsstChat.tsx");
  const css = read("front-end/static/assistant-page.css");

  it("REQ-384 the island no longer renders the full-viewport .chat__pro-pop backdrop", () => {
    expect(island).not.toMatch(/class="chat__pro-pop"/);
    expect(css).not.toMatch(/\.chat__pro-pop\s*\{/);
  });

  it("REQ-384 the offer row renders inside the bullet list, right after its bullet", () => {
    const list = island.indexOf('<ul class="chat__jobopt-bullets">');
    const row = island.indexOf('data-cy="polish-offer"');
    const addRow = island.indexOf('<li class="chat__jobopt-add">');
    expect(list).toBeGreaterThan(0);
    expect(row).toBeGreaterThan(list);
    expect(row).toBeLessThan(addRow);
    // it quotes the line and the rewrite
    expect(island).toMatch(/data-cy="polish-offer-before"/);
    expect(island).toMatch(/data-cy="polish-offer-after"/);
  });

  it("REQ-384 the island decides whether to offer through polishOffer", () => {
    expect(island).toMatch(
      /from "@shared\/quote-flow\/polish-offer\.ts"|from "\.\.\/\.\.\/shared\/quote-flow\/polish-offer\.ts"/,
    );
    expect(island).toMatch(/polishOffer\(/);
  });

  it("REQ-384 the offer row is not a fixed overlay", () => {
    const rule = css.match(/\.chat__pro-row\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).not.toMatch(/position:\s*fixed/);
  });

  it("REQ-384 the offer's copy exists in en and es", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const k of [
        "asstChat.proPopup.msg",
        "asstChat.proPopup.yes",
        "asstChat.proPopup.no",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
    }
    expect(en["asstChat.proPopup.msg"]).toBe("Polish this line?");
    expect(es["asstChat.proPopup.msg"]).toBe("¿Pulir esta línea?");
  });
});
