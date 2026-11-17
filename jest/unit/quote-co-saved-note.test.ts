/**
 * REQ-683 — demo-loop cycle 5, issue m41: after an Edit, a change-order row on
 * the quote panel said "CO-001 saved as Version 2 — back to pending until the
 * customer approves it again." and kept saying it beside "Approved" once the
 * customer approved, until a reload (pair 5). The note was local state cleared
 * only by a new edit or a withdraw — never by the live ledger.
 *
 *   shared/documents/change-order-actions.ts  changeOrderSavedNote
 *   front-end/islands/QuotesPage.tsx          the row renders the note from it
 *
 * Lazy-required so a missing export reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const actions = () => require("../../shared/documents/change-order-actions");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-683 (m41) changeOrderSavedNote — the 'saved as Version N — back to pending' note", () => {
  it("REQ-683 stands while the saved version still waits for the customer", () => {
    const { changeOrderSavedNote } = actions();
    expect(changeOrderSavedNote({ status: "pending", version: 2 }, 2)).toBe(2);
  });

  it("REQ-683 is gone once the customer approves (pair 5: beside 'Approved')", () => {
    const { changeOrderSavedNote } = actions();
    expect(changeOrderSavedNote({ status: "approved", version: 2 }, 2))
      .toBeNull();
    expect(changeOrderSavedNote({ status: "declined", version: 2 }, 2))
      .toBeNull();
  });

  it("REQ-683 is gone once the order moved past the saved version (edited again elsewhere)", () => {
    const { changeOrderSavedNote } = actions();
    expect(changeOrderSavedNote({ status: "pending", version: 3 }, 2))
      .toBeNull();
  });

  it("REQ-683 nothing saved here → no note", () => {
    const { changeOrderSavedNote } = actions();
    expect(changeOrderSavedNote({ status: "pending", version: 2 }, null))
      .toBeNull();
  });

  it("REQ-683 the status reads case-blind", () => {
    const { changeOrderSavedNote } = actions();
    expect(changeOrderSavedNote({ status: "Pending", version: 2 }, 2)).toBe(2);
    expect(changeOrderSavedNote({ status: "APPROVED", version: 2 }, 2))
      .toBeNull();
  });
});

describe("REQ-683 (m41) the quotes page", () => {
  it("REQ-683 the row's coSaved note is gated on the live order, not only on local state", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    expect(src).toMatch(/changeOrderSavedNote\(\s*co\s*,\s*savedVersion\s*\)/);
    expect(src).not.toMatch(
      /\{savedVersion !== null && !editing && \(\s*<span\s+data-cy="ledger-co-saved"/,
    );
  });
});
