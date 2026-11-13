/**
 * REQ-763 (demo-loop cycle 5v2, M7) — Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * The verifier typed "install LVP no wait porcelain tile 12x24…" in the chat
 * and got Q-001 with an LVP line AND a porcelain line. The pre-pass must keep
 * the verb, the quantity and anything before the corrected-away word, never
 * eat the clause's head ("install", "Quote for Mark:", "200 sqft").
 */
import { dropSelfCorrections } from "../../shared/quote-flow/self-correction";

describe("REQ-763 (M7, cycle 5v2) the self-correction pre-pass keeps the clause's head", () => {
  it("REQ-763 'install LVP no wait porcelain tile 12x24' keeps 'install'", () => {
    expect(dropSelfCorrections("install LVP no wait porcelain tile 12x24"))
      .toBe("install porcelain tile 12x24");
  });

  it("REQ-763 the verifier's message: only LVP goes", () => {
    const out = dropSelfCorrections(
      "install LVP no wait porcelain tile 12x24 in the master bath, 200 sqft, $1,800, for Mark Henderson, client wants it done before thanksgiving",
    );
    expect(out).toBe(
      "install porcelain tile 12x24 in the master bath, 200 sqft, $1,800, for Mark Henderson, client wants it done before thanksgiving",
    );
  });

  it("REQ-763 a lead-in ('Quote for Mark Henderson:') and a typed quantity stay", () => {
    expect(
      dropSelfCorrections(
        "Quote for Mark Henderson: install LVP no wait porcelain tile 12x24",
      ),
    ).toBe("Quote for Mark Henderson: install porcelain tile 12x24");
    expect(dropSelfCorrections("200 sqft LVP no wait porcelain tile 12x24"))
      .toBe("200 sqft porcelain tile 12x24");
    expect(dropSelfCorrections("instalar piso LVP no espera porcelanato 30x60"))
      .toBe("instalar piso porcelanato 30x60");
  });

  it("REQ-763 a quantity corrected by a quantity is still replaced", () => {
    expect(dropSelfCorrections("replace 3 windows make that 4 windows"))
      .toBe("replace 4 windows");
    expect(dropSelfCorrections("3 no wait 4 windows")).toBe("4 windows");
  });
});
