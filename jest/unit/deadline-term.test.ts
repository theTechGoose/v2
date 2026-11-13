/**
 * REQ-771 (demo-loop cycle 5v5, M7) — Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * The verifier typed "Bathroom floor for Ana Diaz at 22 Oak St: install LVP
 * no wait porcelain tile 12x24 on the floor, plus a recessed shower niche.
 * Has to be done before Thanksgiving." in the help-me-price flow. Nothing on
 * the finished Q-003 preview (job details or the Terms rows) named the
 * deadline. The deadline is now a term row — "Deadline: Before Thanksgiving
 * (Nov 26, 2026)" — stored in the English base and read in every language.
 */
import * as fs from "fs";
import * as path from "path";
import {
  DEADLINE_STEP_ID,
  deadlineTermValue,
  parseDeadlineTerm,
  withDeadlineTerm,
} from "../../shared/quote-flow/deadline-term";
import { previewTermRows } from "../../shared/quote-flow/wizard-terms";
import { invoiceTerms } from "../../shared/quote-flow/invoice-terms";
import { localizeTermValue } from "../../front-end/lib/term-i18n";
import { tFor } from "../../front-end/lib/i18n";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const THANKSGIVING = deadlineTermValue({
  iso: "2026-11-26",
  before: true,
  holiday: "thanksgiving",
});

describe("REQ-771 (M7, cycle 5v5) a typed deadline is a term row on the quote", () => {
  it("REQ-771 the stored base names the holiday and the day", () => {
    expect(THANKSGIVING).toBe("Before 2026-11-26 (Thanksgiving)");
    expect(parseDeadlineTerm(THANKSGIVING)).toEqual({
      iso: "2026-11-26",
      before: true,
      holiday: "thanksgiving",
    });
    expect(deadlineTermValue({ iso: "2026-12-05", before: false }))
      .toBe("By 2026-12-05");
    expect(parseDeadlineTerm("Right away")).toBeNull();
  });

  it("REQ-771 every reader localizes it: 'Before Thanksgiving (Nov 26, 2026)' / 'Antes de Acción de Gracias (26 nov 2026)'", () => {
    expect(localizeTermValue(THANKSGIVING, "en"))
      .toBe("Before Thanksgiving (Nov 26, 2026)");
    expect(localizeTermValue(THANKSGIVING, "es"))
      .toBe("Antes de Acción de Gracias (26 nov 2026)");
    expect(localizeTermValue("By 2026-12-05", "en")).toBe("By Dec 5, 2026");
    expect(localizeTermValue("By 2026-12-05", "es"))
      .toBe("A más tardar el 5 dic 2026");
  });

  it("REQ-771 the in-app preview's Terms rows carry the deadline", () => {
    const rows = previewTermRows({
      quoteTerms: [
        { stepId: "start_date", label: "Start date", value: "Right away" },
        { stepId: "wraps", label: "Time to complete", value: "1 week" },
        { stepId: DEADLINE_STEP_ID, label: "Deadline", value: THANKSGIVING },
        { stepId: "payment_terms", label: "Payment", value: "Due Now" },
      ],
      messages: [],
      previewLang: "en",
      t: tFor,
      localize: localizeTermValue,
    });
    const row = rows.find((r) => r.stepId === DEADLINE_STEP_ID);
    expect(row?.value).toBe("Before Thanksgiving (Nov 26, 2026)");
  });

  it("REQ-771 withDeadlineTerm puts the row after the time to complete, replaces an older one, and leaves terms alone without a deadline", () => {
    const base = [
      { stepId: "start_date", label: "Start date", value: "Right away" },
      { stepId: "wraps", label: "Time to complete", value: "1 week" },
      { stepId: "payment_terms", label: "Payment", value: "Due Now" },
    ];
    const out = withDeadlineTerm(base, {
      iso: "2026-11-26",
      before: true,
      holiday: "thanksgiving",
    });
    expect(out.map((t) => t.stepId)).toEqual([
      "start_date",
      "wraps",
      DEADLINE_STEP_ID,
      "payment_terms",
    ]);
    const again = withDeadlineTerm(out, { iso: "2026-12-05", before: false });
    expect(again.filter((t) => t.stepId === DEADLINE_STEP_ID)).toEqual([
      { stepId: DEADLINE_STEP_ID, label: "Deadline", value: "By 2026-12-05" },
    ]);
    expect(withDeadlineTerm(base, null)).toEqual(base);
    expect(withDeadlineTerm([], { iso: "2026-11-26", before: true }))
      .toEqual([]);
  });

  it("REQ-771 an invoice (the job is done) drops the deadline row", () => {
    expect(
      invoiceTerms([
        { stepId: "wraps", value: "1 week" },
        { stepId: DEADLINE_STEP_ID, value: THANKSGIVING },
      ], { quotedAt: "2026-11-12", issuedAt: "2026-11-30" })
        .map((t) => t.stepId),
    ).toEqual(["wraps"]);
  });

  it("REQ-771 the row is labelled in every reader (preview, public agreement, PDF) in en + es", () => {
    for (
      const key of [
        "asstChat.preview.termLabel.deadline",
        "quoteDoc.termLabel.deadline",
        "renderQuotePdf.termLabel.deadline",
        "deadlineTerm.before",
        "deadlineTerm.by",
        "deadlineTerm.beforeNamed",
        "deadlineTerm.byNamed",
        "deadlineTerm.holiday.thanksgiving",
      ]
    ) {
      expect([key, typeof en[key]]).toEqual([key, "string"]);
      expect([key, typeof es[key]]).toEqual([key, "string"]);
    }
    expect(read("front-end/islands/AsstChat.tsx")).toMatch(
      /deadline:\s*"asstChat\.preview\.termLabel\.deadline"/,
    );
    expect(read("front-end/components/quote-doc.tsx")).toMatch(
      /deadline:\s*tFor\(lang,\s*"quoteDoc\.termLabel\.deadline"\)/,
    );
    expect(
      read("backend/src/paperwork/domain/coordinators/render-quote-pdf/mod.ts"),
    ).toMatch(/deadline:\s*"renderQuotePdf\.termLabel\.deadline"/);
  });
});
