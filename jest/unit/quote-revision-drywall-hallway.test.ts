/**
 * REQ-1095 (LOOP-007 cycle 3, q3-19) — on Q-002 the chat removed "Reparación
 * de drywall en la cocina" ($380) and added "Pintura del pasillo" ($450).
 * The assistant said the drywall was REMOVED, but the /quotes Unpublished-
 * changes panel read "Reparación de drywall en la cocina → Pintura del
 * pasillo ($380.00 → $450.00)" — a rename. versionChanges' matchLines pairs
 * leftover lines by position whenever both sides have the same number left,
 * however unrelated the descriptions are.
 *
 * Lazy-required so a missing export reds only the tests that use it.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const v = () => require("../../shared/documents/versions");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");

const PAINT = "Pintura interior";
const DRYWALL = "Reparación de drywall en la cocina";
const HALLWAY = "Pintura del pasillo";
const line = (description: string, price: number) => ({
  description,
  quantity: 1,
  unit: "trabajo",
  price,
});

const v1 = {
  estimatedTotal: 268000,
  lineItems: [line(PAINT, 230000), line(DRYWALL, 38000)],
};
const v2Lines = [line(PAINT, 230000), line(HALLWAY, 45000)];

describe("REQ-1095 q3-19 an unrelated line swapped in is removed + added, never a rename", () => {
  it("REQ-1095 q3-19: [Pintura, Drywall] → [Pintura, Pasillo] reports drywall removed and hallway added", () => {
    const { versionChanges } = v();
    expect(
      versionChanges(v1, { estimatedTotal: 275000, lineItems: v2Lines }),
    ).toEqual({
      totalFromCents: 268000,
      totalToCents: 275000,
      linesAdded: 1,
      linesRemoved: 1,
      linesChanged: 0,
      added: [{ description: HALLWAY, totalCents: 45000 }],
      removed: [{ description: DRYWALL, totalCents: 38000 }],
    });
  });

  it("REQ-1095 q3-19: the owner's Unpublished-changes line never shows 'drywall → Pintura del pasillo'", () => {
    const { pendingRevisionChanges } = v();
    const { versionChangeLine } = lv();
    const doc = {
      ...v1,
      status: "sent",
      pendingRevision: { lineItems: v2Lines, estimatedTotal: 275000 },
    };
    const text = versionChangeLine(pendingRevisionChanges(doc), "en");
    expect(text).not.toMatch(/drywall en la cocina \(\$380\.00\) → /);
    expect(text).not.toMatch(/→ Pintura del pasillo/);
    expect(text).toMatch(/Removed: Reparación de drywall en la cocina/);
    expect(text).toMatch(/Added: Pintura del pasillo/);
  });
});
