/**
 * PDF p13 (THE EMAIL) — the quote email SUBJECT must not wrap the job name
 * in quotation marks ("" were literal in the output; they should not be).
 *
 * Target: shared/quote-flow/email-subject.ts
 */
import { buildQuoteEmailSubject } from "../../shared/quote-flow/email-subject";

describe("buildQuoteEmailSubject", () => {
  const args = {
    jobName: "Backyard Junk Removal",
    contractorName: "Hans Pedersen",
  };

  it("contains the job name verbatim", () => {
    expect(buildQuoteEmailSubject(args)).toContain("Backyard Junk Removal");
  });

  it("contains no wrapping quotation marks (p13's complaint; apostrophes stay legal)", () => {
    const subject = buildQuoteEmailSubject(args);
    expect(subject).not.toMatch(/["“”]/);
  });

  it("does not quote a job name even when the caller passes one pre-quoted", () => {
    const subject = buildQuoteEmailSubject({ ...args, jobName: '"Backyard Junk Removal"' });
    expect(subject).not.toMatch(/["“”]/);
    expect(subject).toContain("Backyard Junk Removal");
  });

  it("mentions who it is from so the customer recognizes the sender", () => {
    expect(buildQuoteEmailSubject(args)).toMatch(/Hans Pedersen/);
  });
});
