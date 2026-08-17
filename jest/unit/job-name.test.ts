/**
 * PDF p8 — "Job Name": take the job details and summarize into a name of
 * THREE WORDS OR LESS, used consistently across the whole platform (quote
 * heading, in-chat card, email subject, SMS body, contract hero).
 *
 * Pins the deterministic fallback summarizer + the validator the LLM path
 * must also satisfy. Target: shared/quote-flow/job-name.ts
 */
import { isValidJobName, summarizeJobName } from "../../shared/quote-flow/job-name";

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

  it("rejects four or more words", () => {
    expect(isValidJobName("Removing Junk From Backyard")).toBe(false);
  });

  it("rejects empty and whitespace-only names", () => {
    expect(isValidJobName("")).toBe(false);
    expect(isValidJobName("   ")).toBe(false);
  });
});
