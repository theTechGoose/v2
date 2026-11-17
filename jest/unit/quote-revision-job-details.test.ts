/**
 * REQ-561 — demo-loop cycle 4, issue M28: the revision editor ("Edit →
 * Version 2") edits the job-detail bullets the customer reads.
 *
 * The bullets on the agreement are quote.description (quote-doc.tsx →
 * JobDetailsSection → detailLines). The editor only had line items, so a
 * contractor could not change "my 3 bullet lines" in a revision.
 *
 *   front-end/lib/quote-line-edit.ts   editableJobDetails, jobDetailsPatch
 *   shared/documents/versions.ts       versionChanges → descriptionChanged
 *   shared/documents/linked-view.ts    versionChangeLine "Job details changed"
 *   front-end/islands/QuotesPage.tsx   the job-details textarea + save body
 *   lang/en.json, lang/es.json         quotesPage.edit.jobDetails(+Hint)
 *
 * Lazy-required so a missing export reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const edit = () => require("../../front-end/lib/quote-line-edit");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const v = () => require("../../shared/documents/versions");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const V1 = "Remove old shingles\nInstall underlayment\nHaul debris";
const V2 =
  "Remove old shingles\nInstall underlayment\nReplace rafters\nHaul debris";

describe("REQ-561 (M28) editableJobDetails — the editor starts from the bullets the customer reads", () => {
  it("REQ-561 prefills from the live description", () => {
    expect(edit().editableJobDetails({ description: V1 })).toBe(V1);
  });
  it("REQ-561 prefers the pending revision's description (the working copy)", () => {
    expect(
      edit().editableJobDetails({
        description: V1,
        pendingRevision: { description: V2 },
      }),
    ).toBe(V2);
  });
  it("REQ-561 no description → empty", () => {
    expect(edit().editableJobDetails({})).toBe("");
    expect(edit().editableJobDetails(null)).toBe("");
  });
});

describe("REQ-561 (M28) jobDetailsPatch — only a real change goes into the save body", () => {
  it("REQ-561 unchanged text sends nothing", () => {
    expect(edit().jobDetailsPatch(V1, V1)).toEqual({});
    expect(edit().jobDetailsPatch(V1, `  ${V1}\n\n`)).toEqual({});
  });
  it("REQ-561 a new bullet sends the description, one bullet per line, blank lines dropped", () => {
    expect(
      edit().jobDetailsPatch(
        V1,
        "Remove old shingles\n\n Install underlayment \nReplace rafters\nHaul debris\n",
      ),
    ).toEqual({ description: V2 });
  });
});

describe("REQ-561 (M28) versionChanges / versionChangeLine — a job-details change is named", () => {
  const live = {
    description: V1,
    lineItems: [{ description: "Shingles", quantity: 1, price: 100000 }],
    estimatedTotal: 100000,
  };
  it("REQ-561 descriptionChanged when the bullets differ, absent when they don't", () => {
    expect(
      v().versionChanges(live, { ...live, description: V2 }),
    ).toMatchObject({ descriptionChanged: true });
    expect(
      v().versionChanges(live, { ...live }).descriptionChanged,
    ).toBeUndefined();
  });
  it("REQ-561 the pending preview says 'Job details changed' (en/es)", () => {
    const doc = { ...live, pendingRevision: { description: V2 } };
    const c = v().pendingRevisionChanges(doc);
    expect(lv().versionChangeLine(c, "en")).toContain("Job details changed");
    expect(lv().versionChangeLine(c, "es")).toContain(
      "Detalles del trabajo cambiados",
    );
  });
  it("REQ-561 a job-details-only revision is not 'Wording or terms updated'", () => {
    const doc = { ...live, pendingRevision: { description: V2 } };
    expect(v().pendingOtherContentChanged(doc)).toBe(false);
  });
});

describe("REQ-561 (M28) the revision editor renders and saves the job details", () => {
  const src = read("front-end/islands/QuotesPage.tsx");
  const start = src.indexOf("function QuoteLineEditor(");
  const editor = src.slice(start, src.indexOf("\nfunction ", start + 10));
  it("REQ-561 QuoteLineEditor has a job-details textarea prefilled from editableJobDetails", () => {
    expect(start).toBeGreaterThan(-1);
    expect(editor).toMatch(/<textarea[\s\S]*data-cy="quote-edit-job-details"/);
    expect(editor).toMatch(/editableJobDetails\(q\)/);
    expect(editor).toMatch(/quotesPage\.edit\.jobDetails"/);
  });
  it("REQ-561 save sends jobDetailsPatch with the lines", () => {
    expect(editor).toMatch(/\.\.\.jobDetailsPatch\(/);
  });
  it("REQ-561 en and es carry the labels", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (const k of [
      "quotesPage.edit.jobDetails",
      "quotesPage.edit.jobDetailsHint",
    ]) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    }
    expect(en["quotesPage.edit.jobDetails"]).toMatch(/customer/i);
  });
});
