/**
 * PDF p15 — Text to customer, exact template:
 *
 *   Hi [Customer Name], this is [Contractor Name] from [Business Name].
 *   Your Quote + Agreement for [Job Name] is ready:
 *   [LINK]
 *   Please let me know if you have any questions. I look forward to working with you!
 *
 * Target: shared/quote-flow/sms-template.ts
 */
import { buildQuoteReadySms } from "../../shared/quote-flow/sms-template";

describe("buildQuoteReadySms", () => {
  const args = {
    customerName: "Green",
    contractorName: "Hans Pedersen",
    businessName: "HANS LLC",
    jobName: "Backyard Junk Removal",
    link: "https://paperworkmonster.com/s/umn591",
  };

  it("opens with the personalized greeting and introduction", () => {
    expect(buildQuoteReadySms(args)).toMatch(
      /^Hi Green, this is Hans Pedersen from HANS LLC\./,
    );
  });

  it("announces the Quote + Agreement by job name", () => {
    expect(buildQuoteReadySms(args)).toContain(
      "Your Quote + Agreement for Backyard Junk Removal is ready:",
    );
  });

  it("includes the signing link on its own line", () => {
    const lines = buildQuoteReadySms(args).split("\n").map((l) => l.trim());
    expect(lines).toContain("https://paperworkmonster.com/s/umn591");
  });

  it("closes with the questions + looking-forward line", () => {
    expect(buildQuoteReadySms(args)).toMatch(
      /Please let me know if you have any questions\. I look forward to working with you!$/,
    );
  });

  it("leaves no unresolved [placeholders]", () => {
    expect(buildQuoteReadySms(args)).not.toMatch(/\[[A-Za-z ]+\]/);
  });
});
