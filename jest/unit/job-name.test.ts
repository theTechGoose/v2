/**
 * PDF p8 — "Job Name": take the job details and summarize into a name of
 * THREE WORDS OR LESS, used consistently across the whole platform (quote
 * heading, in-chat card, email subject, SMS body, contract hero).
 *
 * Pins the deterministic fallback summarizer + the validator the LLM path
 * must also satisfy. Target: shared/quote-flow/job-name.ts
 */
import {
  isValidJobName,
  JOB_NAME_MAX_CHARS,
  JOB_NAME_MAX_WORDS,
  summarizeJobName,
} from "../../shared/quote-flow/job-name";

describe("summarizeJobName", () => {
  it("produces at most three words", () => {
    const name = summarizeJobName(
      "Removing junk from a backyard and maksure sure no trash remains",
    );
    expect(name.trim().length).toBeGreaterThan(0);
    expect(name.trim().split(/\s+/).length).toBeLessThanOrEqual(3);
  });

  it("is deterministic for the same input", () => {
    const details = "Replace 6 fence panels along the south side of the yard";
    expect(summarizeJobName(details)).toBe(summarizeJobName(details));
  });

  it("title-cases the result for display headings", () => {
    const name = summarizeJobName("remove old toilet, install new toilet, test for leaks");
    for (const word of name.split(/\s+/)) {
      expect(word[0]).toBe(word[0].toUpperCase());
    }
  });

  it("strips punctuation and line-item bullets from the source details", () => {
    const name = summarizeJobName("- Remove old toilet\n- Install new toilet\n- Test for leaks");
    expect(name).not.toMatch(/[-•·,.:;\n]/);
  });

  it("still yields a non-empty name for terse one-word details", () => {
    const name = summarizeJobName("landscaping");
    expect(name.trim().length).toBeGreaterThan(0);
    expect(name.trim().split(/\s+/).length).toBeLessThanOrEqual(3);
  });

  it("never echoes the entire long description", () => {
    const details =
      "Full kitchen refresh including cabinet resurfacing, new backsplash tile, " +
      "under-cabinet lighting, sink replacement and haul-away of all debris";
    expect(summarizeJobName(details).length).toBeLessThan(details.length / 2);
  });
});

describe("isValidJobName", () => {
  it("accepts one, two, and three word names", () => {
    expect(isValidJobName("Fence Repair")).toBe(true);
    expect(isValidJobName("Landscaping")).toBe(true);
    expect(isValidJobName("Backyard Junk Removal")).toBe(true);
  });

  // REQ-337 (demo p15-1): the hard 3-word cap became a 5-word / 30-char
  // budget so a name can cover every area named ("Bedroom & Hallway Repaint").
  it("REQ-337 accepts a four-word name inside the budget, rejects one over it", () => {
    expect(JOB_NAME_MAX_WORDS).toBe(5);
    expect(JOB_NAME_MAX_CHARS).toBe(30);
    expect(isValidJobName("Bedroom & Hallway Repaint")).toBe(true);
    expect(isValidJobName("Repintar dormitorios y pasillo")).toBe(true);
    expect(isValidJobName("Removing All The Junk From The Backyard")).toBe(false);
    expect(isValidJobName("Full Kitchen Refresh With Lighting")).toBe(false); // 34 chars
  });

  it("rejects empty and whitespace-only names", () => {
    expect(isValidJobName("")).toBe(false);
    expect(isValidJobName("   ")).toBe(false);
  });
});

/**
 * REQ-337 (demo-loop cycle 1, m6): the model's summary carries the customer
 * ("Bathroom remodel — Dana") and the contractor's sentence carries the
 * recipient ("… for Maria Lopez"); neither belongs in the document title.
 */
describe("REQ-337 m6: summaries with a customer tail or recipient derive a clean title", () => {
  it("strips the '— <customer>' tail before deriving (es, sentence case)", () => {
    expect(summarizeJobName("Mantenimiento de jardín mensual — María López", "es"))
      .toBe("Mantenimiento de jardín");
  });

  it("strips the '— <customer>' tail before deriving (en)", () => {
    expect(summarizeJobName("Panel swap — customer x")).toBe("Panel Swap");
    expect(summarizeJobName("Bathroom remodel — Dana")).toBe("Bathroom Remodel");
    expect(summarizeJobName("Bathroom remodel - Dana Whitfield", "en")).toBe("Bathroom Remodel");
  });

  it("drops a leading 'Quote:' label", () => {
    expect(summarizeJobName("Quote: Deep clean — Maria Lopez")).toBe("Deep Clean");
    expect(summarizeJobName("Cotización: Limpieza profunda — María", "es")).toBe("Limpieza profunda");
  });

  it("cuts at 'for'/'para' when the recipient follows, and skips digit-led fragments (en)", () => {
    expect(summarizeJobName("Deep clean 3-bed house for Maria Lopez")).toBe("Deep Clean House");
    expect(summarizeJobName("Roof repair for Jim Roof and gutters")).toBe("Roof Repair");
    expect(summarizeJobName("Kitchen backsplash para la señora Gómez")).toBe("Kitchen Backsplash");
  });

  it("cuts at 'para' before a recipient (es) and never ends on a number", () => {
    expect(summarizeJobName("Pintura exterior para María López", "es")).toBe("Pintura exterior");
    expect(summarizeJobName("Cambiar 12 tablas del deck", "es")).toBe("Cambiar 12 tablas");
    expect(summarizeJobName("Reparar puertas 2", "es")).toBe("Reparar puertas");
  });

  it("still keeps 'for' when no recipient follows", () => {
    expect(summarizeJobName("Quote for kitchen remodel")).toBe("Kitchen Remodel");
  });
});
