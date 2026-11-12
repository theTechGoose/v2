/**
 * REQ-248 — demo issue quote-invoice-money-m9: "a revision gives no notice or
 * comparison; version 1 has publishedBy: {}".
 *
 *   shared/documents/versions.ts     firstIssueStamp, applyRevision,
 *                                    pendingRevisionNotice, versionChanges
 *   shared/documents/linked-view.ts  versionChangeLine
 *   front-end/islands/AsstChat.tsx   the review card's unpublished-change note
 *   front-end/islands/QuotesPage.tsx the version history's comparison line
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

describe("REQ-248 firstIssueStamp — the first issue is version 1's publication", () => {
  it("REQ-248 a first send stamps publishedAt = sentAt and publishedBy = the owner", () => {
    const { firstIssueStamp } = v();
    expect(
      firstIssueStamp(
        { userId: "u1" },
        { status: "sent", sentAt: "2026-11-10T10:00:00Z" },
      ),
    ).toEqual({
      publishedAt: "2026-11-10T10:00:00Z",
      publishedBy: { userId: "u1" },
    });
  });

  it("REQ-248 a named publisher is kept as given", () => {
    const { firstIssueStamp } = v();
    expect(
      firstIssueStamp(
        { userId: "u1" },
        { sentAt: "2026-11-10T10:00:00Z" },
        { userId: "u1", name: "Rafa" },
      ).publishedBy,
    ).toEqual({ userId: "u1", name: "Rafa" });
  });

  it("REQ-248 never re-stamps: an already-published document and a patch without sentAt get nothing", () => {
    const { firstIssueStamp } = v();
    expect(
      firstIssueStamp(
        { userId: "u1", publishedAt: "2026-11-01T00:00:00Z" },
        { sentAt: "2026-11-10T10:00:00Z" },
      ),
    ).toEqual({});
    expect(firstIssueStamp({ userId: "u1" }, { estimatedTotal: 5 }))
      .toEqual({});
  });
});

describe("REQ-248 applyRevision — the filed version 1 names who and when", () => {
  it("REQ-248 a version 1 issued before the stamp existed is filed with the owner, at its sentAt — never publishedBy: {}", () => {
    const { applyRevision } = v();
    const { filed } = applyRevision(
      {
        id: "q1",
        userId: "u1",
        sentAt: "2026-11-01T09:00:00Z",
        updatedAt: "2026-11-09T09:00:00Z",
        estimatedTotal: 1470000,
      },
      { estimatedTotal: 1520000 },
      { userId: "u1", name: "Rafa" },
      "2026-11-10T00:00:00Z",
    );
    expect(filed.publishedBy).toEqual({ userId: "u1" });
    expect(filed.publishedAt).toBe("2026-11-01T09:00:00Z");
  });
});

describe("REQ-248 pendingRevisionNotice — an issued quote's edit says it is unpublished", () => {
  it("REQ-248 an issued quote with a pending edit → sending publishes Version N+1", () => {
    const { pendingRevisionNotice } = v();
    expect(
      pendingRevisionNotice({
        status: "sent",
        sentAt: "2026-11-10T10:00:00Z",
        version: 1,
        pendingRevision: { estimatedTotal: 1520000 },
      }),
    ).toEqual({ nextVersion: 2 });
    expect(
      pendingRevisionNotice({
        status: "sent",
        version: 3,
        pendingRevision: { lineItems: [] },
      }),
    ).toEqual({ nextVersion: 4 });
  });

  it("REQ-248 a draft, an empty pending revision, and a signed quote say nothing", () => {
    const { pendingRevisionNotice } = v();
    expect(pendingRevisionNotice({ status: "draft" })).toBeNull();
    expect(
      pendingRevisionNotice({ status: "sent", pendingRevision: {} }),
    ).toBeNull();
    expect(
      pendingRevisionNotice({
        status: "accepted",
        pendingRevision: { estimatedTotal: 1 },
      }),
    ).toBeNull();
  });
});

describe("REQ-248 versionChanges + versionChangeLine — what a revision changed", () => {
  const before = {
    estimatedTotal: 1470000,
    lineItems: [
      { description: "Shingles", quantity: 1, price: 1000000 },
      { description: "Labor", quantity: 1, price: 470000 },
    ],
  };
  const after = {
    estimatedTotal: 1520000,
    lineItems: [
      { description: "Shingles", quantity: 1, price: 1050000 },
      { description: "Labor", quantity: 1, price: 470000 },
      { description: "Dumpster", quantity: 1, price: 0 },
    ],
  };

  it("REQ-248 the total's from → to and the line items added / removed / changed", () => {
    const { versionChanges } = v();
    expect(versionChanges(before, after)).toEqual({
      totalFromCents: 1470000,
      totalToCents: 1520000,
      linesAdded: 1,
      linesRemoved: 0,
      linesChanged: 1,
    });
  });

  it("REQ-248 identical content → no changes", () => {
    const { versionChanges } = v();
    expect(versionChanges(before, before)).toEqual({
      linesAdded: 0,
      linesRemoved: 0,
      linesChanged: 0,
    });
  });

  it("REQ-248 reads 'Total $14,700.00 → $15,200.00 · 1 line added · 1 line changed'", () => {
    const { versionChanges } = v();
    const { versionChangeLine } = lv();
    expect(versionChangeLine(versionChanges(before, after), "en")).toBe(
      "Total $14,700.00 → $15,200.00 · 1 line added · 1 line changed",
    );
    expect(versionChangeLine(versionChanges(before, after), "es")).toBe(
      "Total $14,700.00 → $15,200.00 · 1 línea agregada · 1 línea cambiada",
    );
    expect(
      versionChangeLine({ linesAdded: 0, linesRemoved: 2, linesChanged: 0 }),
    ).toBe("2 lines removed");
    expect(
      versionChangeLine({ linesAdded: 0, linesRemoved: 0, linesChanged: 0 }),
    ).toBe("");
  });
});

describe("REQ-248 the pages say it", () => {
  it("REQ-248 the assistant's review card shows the unpublished-change note from pendingRevisionNotice, and the total edit keeps the server's pendingRevision", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(/pendingRevisionNotice\(/);
    expect(src).toMatch(/asstChat\.preview\.unpublishedChange/);
    expect(src).toMatch(/data-cy="quote-review-unpublished"/);
    // onEditTotal reads the PUT's answer instead of assuming the edit is live
    const edit = src.slice(src.indexOf("async function onEditTotal("));
    expect(edit.slice(0, 2500)).toMatch(
      /const saved = await quotesClient\.update\([\s\S]*revisionStateOf\(saved\)/,
    );
    // revisionStateOf carries the server's pendingRevision onto the card's quote
    const helper = src.slice(src.indexOf("function revisionStateOf("));
    expect(helper.slice(0, 900)).toMatch(/pendingRevision: q\.pendingRevision/);
  });

  it("REQ-248 the quote panel's version history shows what each version changed", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    expect(src).toMatch(/versionChangeLine\(/);
    expect(src).toMatch(/versionChanges\(/);
    expect(src).toMatch(/data-cy="quote-version-changes"/);
  });

  it("REQ-248 both languages carry the unpublished-change note and the revision divider", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const key of [
        "asstChat.preview.unpublishedChange",
        "sendQuote.divider.revisionPublished",
      ]
    ) {
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
    }
    expect(en["asstChat.preview.unpublishedChange"]).toContain("{version}");
    expect(es["asstChat.preview.unpublishedChange"]).toContain("{version}");
    expect(en["sendQuote.divider.revisionPublished"]).toContain("{version}");
    expect(es["sendQuote.divider.revisionPublished"]).toContain("{version}");
  });
});
