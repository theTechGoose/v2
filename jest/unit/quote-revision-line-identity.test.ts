/**
 * REQ-1024 (LOOP-007 cycle 2, q2-6 + q2-42) — removing the MIDDLE line of a
 * revision was summarised as "Removed: <last line> · Changed: <middle> →
 * <last>". versionChanges paired lines by array position, so every line
 * after the removed one shifted onto its neighbour. The owner's
 * "Unpublished changes" summary (pendingRevisionChanges) and the customer's
 * /q "what changed" banner (changesFromPrevious) both read that diff.
 *
 * The tester's own Q-002 data: v1 = [Pintura exterior $4,200, Reparación de
 * cerca $900, Materiales $1,350]; the fence line removed and the painting
 * repriced → v2 = [Pintura exterior $5,550, Materiales $1,350].
 *
 * Lazy-required so a missing export reds only the tests that use it.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const v = () => require("../../shared/documents/versions");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");

const PAINT = "Pintura exterior";
const FENCE = "Reparación de cerca de madera (18 pies lineales)";
const MATS = "Materiales para pintura";
const line = (description: string, price: number) => ({
  description,
  quantity: 1,
  unit: "trabajo",
  price,
});

const v1 = {
  estimatedTotal: 645000,
  lineItems: [line(PAINT, 420000), line(FENCE, 90000), line(MATS, 135000)],
};
const v2 = {
  estimatedTotal: 690000,
  lineItems: [line(PAINT, 555000), line(MATS, 135000)],
};

describe("REQ-1024 versionChanges matches lines by identity, not by position", () => {
  it("REQ-1024 q2-6/q2-42: [A,B,C] → [A',C] reports B removed and A changed; C is not listed", () => {
    const { versionChanges } = v();
    expect(versionChanges(v1, v2)).toEqual({
      totalFromCents: 645000,
      totalToCents: 690000,
      linesAdded: 0,
      linesRemoved: 1,
      linesChanged: 1,
      removed: [{ description: FENCE, totalCents: 90000 }],
      changed: [{
        from: { description: PAINT, totalCents: 420000 },
        to: { description: PAINT, totalCents: 555000 },
      }],
    });
  });

  it("REQ-1024 q2-6: the Spanish banner line names the fence as removed, never 'Eliminado: Materiales'", () => {
    const { versionChanges } = v();
    const { versionChangeLine } = lv();
    const text = versionChangeLine(versionChanges(v1, v2), "es");
    expect(text).not.toMatch(/Eliminado: Materiales/);
    expect(text).not.toMatch(/→ Materiales/);
    expect(text).toBe(
      `Total $6,450.00 → $6,900.00 · Eliminado: ${FENCE} ($900.00) · Cambiado: ${PAINT} ($4,200.00 → $5,550.00)`,
    );
  });

  it("REQ-1024 q2-42: the owner's Unpublished-changes summary (pendingRevisionChanges) names the removed middle line", () => {
    const { pendingRevisionChanges } = v();
    const { versionChangeLine } = lv();
    const doc = {
      ...v1,
      status: "sent",
      pendingRevision: { lineItems: v2.lineItems, estimatedTotal: 690000 },
    };
    expect(versionChangeLine(pendingRevisionChanges(doc), "en")).toBe(
      `Total $6,450.00 → $6,900.00 · Removed: ${FENCE} ($900.00) · Changed: ${PAINT} ($4,200.00 → $5,550.00)`,
    );
  });

  it("REQ-1024 a pure reorder is no line change at all", () => {
    const { versionChanges } = v();
    const reordered = {
      estimatedTotal: 645000,
      lineItems: [line(MATS, 135000), line(PAINT, 420000), line(FENCE, 90000)],
    };
    expect(versionChanges(v1, reordered)).toEqual({
      linesAdded: 0,
      linesRemoved: 0,
      linesChanged: 0,
    });
  });

  it("REQ-1024 a line inserted in the middle is one line added — nothing changed or removed", () => {
    const { versionChanges } = v();
    const inserted = {
      estimatedTotal: 705000,
      lineItems: [
        line(PAINT, 420000),
        line("Lavado a presión", 60000),
        line(FENCE, 90000),
        line(MATS, 135000),
      ],
    };
    expect(versionChanges(v1, inserted)).toEqual({
      totalFromCents: 645000,
      totalToCents: 705000,
      linesAdded: 1,
      linesRemoved: 0,
      linesChanged: 0,
      added: [{ description: "Lavado a presión", totalCents: 60000 }],
    });
  });

  it("REQ-1024 a rename in place (same count, same position) still reads as one change", () => {
    const { versionChanges } = v();
    const renamed = {
      estimatedTotal: 645000,
      lineItems: [
        line(PAINT, 420000),
        line("Reparación de cerca (18 pies)", 90000),
        line(MATS, 135000),
      ],
    };
    expect(versionChanges(v1, renamed)).toEqual({
      linesAdded: 0,
      linesRemoved: 0,
      linesChanged: 1,
      changed: [{
        from: { description: FENCE, totalCents: 90000 },
        to: { description: "Reparación de cerca (18 pies)", totalCents: 90000 },
      }],
    });
  });
});
