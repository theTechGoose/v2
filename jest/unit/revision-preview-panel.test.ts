/**
 * REQ-466 — demo-loop cycle 3 issue m38: Version 2 can't be reviewed before
 * Publish. The open quote's ledger shows what the pending revision changes
 * next to the "Unpublished changes" badge, and a "View draft" toggle lists
 * the draft's line items — without opening the publish confirm.
 *
 *   shared/documents/versions.ts       pendingDraftLines
 *   front-end/islands/QuotesPage.tsx   the badge row renders previewLine and
 *                                      the View draft list
 *
 * Lazy-required so a missing export reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const v = () => require("../../shared/documents/versions");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const live = {
  id: "q1",
  version: 1,
  estimatedTotal: 665000,
  lineItems: [
    { description: "Demo old tile", quantity: 1, unit: "job", price: 345000 },
    {
      description: "Tile shower walls",
      quantity: 1,
      unit: "job",
      price: 320000,
    },
  ],
};

describe("REQ-466 pendingDraftLines — the draft revision's line items", () => {
  it("REQ-466 null when nothing is pending", () => {
    const { pendingDraftLines } = v();
    expect(pendingDraftLines(live)).toBeNull();
    expect(pendingDraftLines({ ...live, pendingRevision: {} })).toBeNull();
    expect(pendingDraftLines(null)).toBeNull();
  });

  it("REQ-466 lists the pending lines with their line totals and the draft total", () => {
    const { pendingDraftLines } = v();
    const d = pendingDraftLines({
      ...live,
      pendingRevision: {
        estimatedTotal: 705000,
        lineItems: [
          live.lineItems[0],
          {
            description: "Tile shower walls",
            quantity: 1,
            unit: "job",
            price: 360000,
          },
        ],
      },
    });
    expect(d).toEqual({
      totalCents: 705000,
      lines: [
        {
          description: "Demo old tile",
          quantity: 1,
          unit: "job",
          totalCents: 345000,
        },
        {
          description: "Tile shower walls",
          quantity: 1,
          unit: "job",
          totalCents: 360000,
        },
      ],
    });
  });

  it("REQ-466 a pending revision without lineItems shows the live lines; quantity multiplies", () => {
    const { pendingDraftLines } = v();
    const d = pendingDraftLines({
      ...live,
      lineItems: [{
        description: "Grout",
        quantity: 3,
        unit: "bag",
        price: 2500,
      }],
      pendingRevision: { notes: "New terms" },
    });
    expect(d).toEqual({
      totalCents: 665000,
      lines: [{
        description: "Grout",
        quantity: 3,
        unit: "bag",
        totalCents: 7500,
      }],
    });
  });
});

describe("REQ-466 the ledger shows the pending change without the confirm", () => {
  const src = read("front-end/islands/QuotesPage.tsx");

  it("REQ-466 the badge row renders previewLine outside the publish confirm", () => {
    const at = src.indexOf('data-cy="quote-pending-changes"');
    expect(at).toBeGreaterThan(-1);
    // it sits with the badge, before the publish preview block
    expect(at).toBeGreaterThan(src.indexOf('data-cy="quote-pending-badge"'));
    expect(at).toBeLessThan(src.indexOf('data-cy="quote-publish-preview"'));
  });

  it("REQ-466 a View draft toggle lists pendingDraftLines", () => {
    expect(src).toContain('data-cy="quote-view-draft"');
    expect(src).toContain('data-cy="quote-draft-lines"');
    expect(src).toContain("pendingDraftLines(");
  });

  it("REQ-466 en/es keys exist and match", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const k of [
        "quotes.ledger.viewDraft",
        "quotes.ledger.hideDraft",
        "quotes.ledger.draftTotal",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toEqual(es[k]);
    }
  });
});
