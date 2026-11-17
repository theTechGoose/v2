/**
 * REQ-304 — demo cycle 1 issues M27 + M28: publishing a revision previews
 * what changes, asks once, refreshes the pipeline, and the customer's page
 * says what changed.
 *
 *   shared/documents/versions.ts       pendingRevisionChanges
 *   front-end/islands/QuotesPage.tsx   the loader re-runs on publish; the
 *                                      publish button is a two-step preview
 *   front-end/components/quote-doc.tsx the public page's what-changed line
 *
 * Lazy-required so a missing export reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const v = () => require("../../shared/documents/versions");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-304 pendingRevisionChanges — the live version against the pending one", () => {
  const live = {
    id: "q1",
    version: 1,
    estimatedTotal: 950000,
    lineItems: [
      { description: "Deck", quantity: 1, unit: "job", price: 950000 },
    ],
  };

  it("REQ-304 a total-only pending revision reads as a total change, never as lines removed", () => {
    const { pendingRevisionChanges } = v();
    const c = pendingRevisionChanges({
      ...live,
      pendingRevision: { estimatedTotal: 1070000 },
    });
    expect(c).toEqual({
      totalFromCents: 950000,
      totalToCents: 1070000,
      linesAdded: 0,
      linesRemoved: 0,
      linesChanged: 0,
    });
  });

  it("REQ-304 a pending revision with a new line counts it", () => {
    const { pendingRevisionChanges } = v();
    const c = pendingRevisionChanges({
      ...live,
      pendingRevision: {
        estimatedTotal: 1070000,
        lineItems: [
          ...live.lineItems,
          { description: "Stairs", quantity: 1, unit: "job", price: 120000 },
        ],
      },
    });
    expect(c.totalFromCents).toBe(950000);
    expect(c.totalToCents).toBe(1070000);
    expect(c.linesAdded).toBe(1);
  });

  it("REQ-304 nothing pending → null", () => {
    const { pendingRevisionChanges } = v();
    expect(pendingRevisionChanges(live)).toBeNull();
    expect(pendingRevisionChanges({ ...live, pendingRevision: {} })).toBeNull();
    expect(pendingRevisionChanges(null)).toBeNull();
  });
});

describe("REQ-304 the quotes page refreshes its pipeline after a publish (M27)", () => {
  it("REQ-304 the cards/hero/KPI loader is a function the panel's refresh calls — not an effect keyed on [lang] alone", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    // the loader is lifted out of the mount effect
    expect(src).toMatch(/function loadPipeline\(/);
    // the panel's refresh bumps the pipeline too
    const refresh = src.slice(src.indexOf("onRefresh={"));
    expect(refresh.slice(0, 400)).toMatch(/loadPipeline\(\)/);
    // no cards effect that is keyed on the language alone any more
    expect(src).not.toMatch(
      /quotesClient\.list\(\)[\s\S]{0,900}\}, \[lang\]\);/,
    );
  });
});

describe("REQ-304 publishing is a two-step with a preview (M28)", () => {
  const src = read("front-end/islands/QuotesPage.tsx");

  it("REQ-304 the publish button opens a preview instead of posting", () => {
    const btn = src.slice(src.indexOf('data-cy="quote-publish"'));
    expect(btn.slice(0, 300)).not.toMatch(/onClick=\{publish\}/);
    expect(src).toMatch(/data-cy="quote-publish-preview"/);
    expect(src).toMatch(/data-cy="quote-publish-confirm"/);
    expect(src).toMatch(/data-cy="quote-publish-cancel"/);
  });

  it("REQ-304 the preview shows the comparison against the live version from pendingRevisionChanges", () => {
    expect(src).toMatch(/pendingRevisionChanges\(/);
    const preview = src.slice(src.indexOf('data-cy="quote-publish-preview"'));
    expect(preview.slice(0, 1500)).toMatch(
      /quotes\.ledger\.publishPreviewTitle/,
    );
  });

  it("REQ-304 the public document renders what changed under its headline", () => {
    const doc = read("front-end/components/quote-doc.tsx");
    expect(doc).toMatch(/changesFromPrevious/);
    expect(doc).toMatch(/versionChangeLine\(/);
    expect(doc).toMatch(/data-cy="public-doc-changes"/);
  });

  it("REQ-304 both languages carry the preview and what-changed copy", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const key of [
        "quotes.ledger.publishPreviewTitle",
        "quotes.ledger.publishConfirm",
        "quotes.ledger.publishCancel",
        "quotes.ledger.publishOtherChanges",
        "public.doc.whatChanged",
      ]
    ) {
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
      expect(en[key]).not.toEqual(es[key]);
    }
    expect(en["quotes.ledger.publishPreviewTitle"]).toContain("{n}");
    expect(es["quotes.ledger.publishPreviewTitle"]).toContain("{n}");
    expect(en["public.doc.whatChanged"]).toContain("{n}");
    expect(es["public.doc.whatChanged"]).toContain("{n}");
  });
});
