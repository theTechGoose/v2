/**
 * REQ-395 — demo-loop cycle 2, issues M12 + m24 + m27 + p13-i: a pending
 * revision that equals the live quote is no revision, an unwanted one can be
 * discarded, the publish box says what actually changes (named lines), the
 * stale "Saved as unpublished Version N" line goes away on publish, and the
 * revision editor's inputs are labelled.
 *
 *   shared/documents/versions.ts      effectivePendingRevision,
 *                                     pendingOtherContentChanged,
 *                                     versionChanges (named lines)
 *   shared/documents/linked-view.ts   versionChangeLine ("Added: …")
 *   front-end/clients/quotes.ts       quotesClient.discardRevision
 *   front-end/islands/QuotesPage.tsx  Discard draft · preview copy ·
 *                                     savedVersion cleared · input labels
 *
 * Lazy-required so a missing export reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const v = () => require("../../shared/documents/versions");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const cabinets = {
  description: "New Cabinets & Countertops",
  quantity: 1,
  unit: "job",
  price: 1850000,
};
const backsplash = {
  description: "Tile backsplash",
  quantity: 1,
  unit: "ea",
  price: 70000,
};
const lighting = {
  description: "Under-cabinet lighting",
  quantity: 2,
  unit: "ea",
  price: 25000,
};
const live = {
  id: "q1",
  version: 2,
  description: "• cabinets\n• countertops",
  estimatedTotal: 1920000,
  lineItems: [
    { ...cabinets, descriptionByLang: { es: "Gabinetes" } },
    backsplash,
  ],
};

describe("REQ-395 (M12) effectivePendingRevision — only what differs from the live quote", () => {
  it("REQ-395 lines + total that equal the live version leave nothing pending", () => {
    const { effectivePendingRevision } = v();
    expect(
      effectivePendingRevision(live, {
        lineItems: [cabinets, backsplash],
        estimatedTotal: 1920000,
      }),
    ).toEqual({});
  });

  it("REQ-395 an added line stays pending, an unchanged field is dropped", () => {
    const { effectivePendingRevision } = v();
    const out = effectivePendingRevision(live, {
      lineItems: [cabinets, backsplash, lighting],
      estimatedTotal: 1970000,
      description: live.description,
    });
    expect(Object.keys(out).sort()).toEqual(["estimatedTotal", "lineItems"]);
  });

  it("REQ-395 a changed wording field is kept", () => {
    const { effectivePendingRevision } = v();
    expect(
      effectivePendingRevision(live, { terms: "Net 15" }),
    ).toEqual({ terms: "Net 15" });
  });
});

describe("REQ-395 (M12) pendingOtherContentChanged — wording/terms really differ", () => {
  it("REQ-395 false when the pending revision carries only lines/total equal to live", () => {
    const { pendingOtherContentChanged } = v();
    expect(
      pendingOtherContentChanged({
        ...live,
        pendingRevision: {
          lineItems: [cabinets, backsplash],
          estimatedTotal: 1920000,
        },
      }),
    ).toBe(false);
  });

  it("REQ-395 true when a non-line content field differs", () => {
    const { pendingOtherContentChanged } = v();
    expect(
      pendingOtherContentChanged({
        ...live,
        pendingRevision: { terms: "Net 15" },
      }),
    ).toBe(true);
    expect(pendingOtherContentChanged({ ...live })).toBe(false);
  });
});

describe("REQ-395 (m24) the change line names the lines", () => {
  const before = {
    estimatedTotal: 1850000,
    lineItems: [cabinets],
  };
  const after = {
    estimatedTotal: 1920000,
    lineItems: [cabinets, backsplash],
  };

  it("REQ-395 versionChanges carries the added line's description and amount", () => {
    const { versionChanges } = v();
    const c = versionChanges(before, after);
    expect(c.linesAdded).toBe(1);
    expect(c.added).toEqual([
      { description: "Tile backsplash", totalCents: 70000 },
    ]);
  });

  it("REQ-395 reads 'Total $18,500.00 → $19,200.00 · Added: Tile backsplash ($700.00)'", () => {
    const { versionChanges } = v();
    const { versionChangeLine } = lv();
    expect(versionChangeLine(versionChanges(before, after), "en")).toBe(
      "Total $18,500.00 → $19,200.00 · Added: Tile backsplash ($700.00)",
    );
    expect(versionChangeLine(versionChanges(before, after), "es")).toBe(
      "Total $18,500.00 → $19,200.00 · Agregado: Tile backsplash ($700.00)",
    );
  });

  it("REQ-395 removed and changed lines are named too", () => {
    const { versionChanges } = v();
    const { versionChangeLine } = lv();
    expect(
      versionChangeLine(versionChanges(after, before), "en"),
    ).toBe(
      "Total $19,200.00 → $18,500.00 · Removed: Tile backsplash ($700.00)",
    );
    const repriced = {
      estimatedTotal: 1950000,
      lineItems: [cabinets, { ...backsplash, price: 100000 }],
    };
    expect(versionChangeLine(versionChanges(after, repriced), "en")).toBe(
      "Total $19,200.00 → $19,500.00 · Changed: Tile backsplash ($700.00 → $1,000.00)",
    );
  });

  it("REQ-395 a count-only change (an old record) still reads as counts", () => {
    const { versionChangeLine } = lv();
    expect(
      versionChangeLine({ linesAdded: 0, linesRemoved: 2, linesChanged: 0 }),
    ).toBe("2 lines removed");
  });
});

describe("REQ-395 the quotes page", () => {
  const src = read("front-end/islands/QuotesPage.tsx");

  it("REQ-395 (M12) a Discard draft button sits by the unpublished badge and posts discardRevision", () => {
    expect(src).toMatch(/data-cy="quote-discard-draft"/);
    expect(src).toMatch(/quotesClient\.discardRevision\(/);
    expect(src).toMatch(/quotes\.ledger\.discardDraft/);
    const client = read("front-end/clients/quotes.ts");
    expect(client).toMatch(/discardRevision:/);
    expect(client).toMatch(/\/discard-revision/);
  });

  it("REQ-395 (M12) the preview says 'wording or terms updated' only when such a field differs", () => {
    expect(src).toMatch(/pendingOtherContentChanged\(/);
    const preview = src.slice(src.indexOf('data-cy="quote-publish-changes"'));
    expect(preview.slice(0, 600)).toMatch(/quotes\.ledger\.nothingToPublish/);
  });

  it("REQ-395 (m27) publishing clears the 'Saved as unpublished Version N' line", () => {
    const at = src.indexOf("onPublished={");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 400)).toMatch(/setSavedVersion\(null\)/);
    // and an edit saved back to the live version shows no "saved" line
    expect(src).toMatch(/savedVersion !== null && hasPending && !editing/);
  });

  it("REQ-395 (p13-i) every editor input has an aria-label and a placeholder", () => {
    const editor = src.slice(
      src.indexOf("function QuoteLineEditor("),
      src.indexOf("function OpenQuotePanel("),
    );
    for (const key of ["description", "qty", "price"]) {
      expect(editor).toMatch(
        new RegExp(
          `aria-label=\\{\`\\$\\{tFor\\(lang, "quotesPage\\.edit\\.${key}"\\)\\} \\$\\{i \\+ 1\\}\`\\}`,
        ),
      );
    }
    expect((editor.match(/placeholder=\{/g) ?? []).length).toBe(3);
  });

  it("REQ-395 both languages carry the new copy", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const key of [
        "quotes.ledger.discardDraft",
        "quotes.ledger.discarding",
        "quotes.ledger.discardError",
        "quotesPage.edit.descriptionPlaceholder",
        "quotesPage.edit.pricePlaceholder",
      ]
    ) {
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
    }
    expect(en["quotes.ledger.discardDraft"]).not.toEqual(
      es["quotes.ledger.discardDraft"],
    );
  });
});
