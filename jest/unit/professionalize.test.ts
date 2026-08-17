/**
 * PDF p5 — "Write it myself" flow: when the user types their own job details
 * it currently "took exactly what I said and that was it." Needs a
 * "Professionalize that" action that breaks the text down, makes it
 * professional, and gives the person the ability to ACCEPT or EDIT it —
 * never silently replacing their words.
 *
 * Pins the pure review-state machine around the LLM call.
 * Target: shared/quote-flow/professionalize.ts
 */
import {
  parseJobLines,
  professionalizeReducer,
  initialProfessionalizeState,
} from "../../shared/quote-flow/professionalize";

describe("parseJobLines", () => {
  it("splits raw textarea input into one item per line", () => {
    expect(parseJobLines("remove old toilet\ninstall new toilet\ntest for leaks"))
      .toEqual(["remove old toilet", "install new toilet", "test for leaks"]);
  });

  it("drops empty lines and trims bullets/whitespace", () => {
    expect(parseJobLines("- fix gate \n\n  •  paint fence\n")).toEqual([
      "fix gate",
      "paint fence",
    ]);
  });
});

describe("professionalize review state machine", () => {
  const raw = ["fix the gate", "paint fence"];
  const polished = [
    "Repair and re-hang the backyard gate",
    "Prep and paint the perimeter fence",
  ];

  it("starts with the user's raw items applied and no pending proposal", () => {
    const s = initialProfessionalizeState(raw);
    expect(s.applied).toEqual(raw);
    expect(s.proposal).toBeNull();
  });

  it("a proposal is held for review, NOT auto-applied", () => {
    const s = professionalizeReducer(initialProfessionalizeState(raw), {
      type: "propose",
      items: polished,
    });
    expect(s.proposal).toEqual(polished);
    expect(s.applied).toEqual(raw); // user's words untouched until they accept
  });

  it("accept applies the proposal and clears it", () => {
    let s = initialProfessionalizeState(raw);
    s = professionalizeReducer(s, { type: "propose", items: polished });
    s = professionalizeReducer(s, { type: "accept" });
    expect(s.applied).toEqual(polished);
    expect(s.proposal).toBeNull();
  });

  it("edit lets the user modify the proposal before accepting", () => {
    let s = initialProfessionalizeState(raw);
    s = professionalizeReducer(s, { type: "propose", items: polished });
    s = professionalizeReducer(s, {
      type: "edit",
      index: 1,
      text: "Prep, prime and paint the fence",
    });
    s = professionalizeReducer(s, { type: "accept" });
    expect(s.applied[1]).toBe("Prep, prime and paint the fence");
  });

  it("reject keeps the user's original items", () => {
    let s = initialProfessionalizeState(raw);
    s = professionalizeReducer(s, { type: "propose", items: polished });
    s = professionalizeReducer(s, { type: "reject" });
    expect(s.applied).toEqual(raw);
    expect(s.proposal).toBeNull();
  });
});
