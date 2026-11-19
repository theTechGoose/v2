/**
 * REQ-1046 — LOOP-007 cycle 2, issues q2-31 + q2-45: one quote, one name.
 *
 * The chat model writes a quote's summary as "<job> — <customer>" (REQ-576
 * reads that tail to bind the customer) and a separate Title Case jobName
 * without the customer. Surfaces that print the raw summary put the
 * customer's name inside the job title: the signed-agreement email's subject
 * and "locked in on …" subhead, and the /quotes open panel's line under the
 * jobName title ("Master Bath Redo" / "Master bath redo — Maria Gonzalez").
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cd = (): any => require("../../shared/quote-flow/customer-dedupe");

describe("REQ-1046 summaryWithoutCustomerTail — the summary without REQ-576's '— <customer>' tail", () => {
  test("REQ-1046 is exported next to customerNameFromSummary", () => {
    expect(typeof cd().summaryWithoutCustomerTail).toBe("function");
  });

  test("REQ-1046 'Master bath redo — Maria Gonzalez' → 'Master bath redo'", () => {
    expect(cd().summaryWithoutCustomerTail("Master bath redo — Maria Gonzalez"))
      .toBe("Master bath redo");
  });

  test("REQ-1046 en dash and hyphen tails are dropped the same way", () => {
    expect(cd().summaryWithoutCustomerTail("Deck repair – Bob Smith")).toBe(
      "Deck repair",
    );
    expect(cd().summaryWithoutCustomerTail("Roof patch - Ana López")).toBe(
      "Roof patch",
    );
  });

  test("REQ-1046 a tail that is not name-shaped stays ('Deck — 2 lines of work')", () => {
    expect(cd().summaryWithoutCustomerTail("Deck — 2 lines of work")).toBe(
      "Deck — 2 lines of work",
    );
    expect(cd().summaryWithoutCustomerTail("Kitchen remodel")).toBe(
      "Kitchen remodel",
    );
  });
});

describe("REQ-1046 surfaces never print the raw '— <customer>' summary as the job's title", () => {
  test("REQ-1046 send-signed-confirmation names the job by jobNameByLang/jobName, not quote.summary", () => {
    const src = read(
      "backend/src/paperwork/domain/coordinators/send-signed-confirmation/mod.ts",
    );
    const usesJobName =
      /jobNameByLang\?\.\[lang\]|quoteJobTitle\(|quoteDisplayTitle\(/.test(src);
    expect({ usesJobName }).toEqual({ usesJobName: true });
    const subjectFromSummary = /summary:\s*quote\.summary\s*\?\?/.test(src);
    const subheadFromSummary = /const summary = \(quote\.summary \?\?/.test(src);
    expect({ subjectFromSummary, subheadFromSummary }).toEqual({
      subjectFromSummary: false,
      subheadFromSummary: false,
    });
  });

  test("REQ-1046 the /quotes open panel's line under the title drops the customer tail", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    const line = src.match(/const summaryText = [^;]+;/)?.[0] ?? "";
    expect(line).toMatch(/summaryWithoutCustomerTail/);
  });
});
