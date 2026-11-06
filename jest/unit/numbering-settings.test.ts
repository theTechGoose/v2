/**
 * REQ-199 — the Settings "Document numbering" card's pure logic:
 *   shared/documents/numbering-settings.ts
 *
 *   numberingPatch(view, form)  → the PUT /profile/numbering body: only the
 *                                 kinds whose typed start differs from the
 *                                 current setting, only unlocked kinds, as
 *                                 integers; blanks / junk / out-of-range are
 *                                 left out.
 *   invalidStartKinds(form)     → the kinds whose typed value is not a
 *                                 positive integer (blank is fine = untouched)
 *   startValueOf(view, kind)    → what the input shows: the setting, else "1"
 *   nextLabel(view, kind, tmpl) → "Next: INV-001"
 *   issuedNumberOf(view, kind)  → the last number issued ("INV-5000" when
 *                                 next is INV-5001), null when nothing issued
 *   lockNote(view, kind, tmpl)  → "Locked — INV-5000 was already issued",
 *                                 "" when the kind is not locked
 *   lockedKindsMessage(kinds, labels, tmpl) → the 409 inline error
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ns = () => require("../../shared/documents/numbering-settings");

const view = (over: Record<string, unknown> = {}) => ({
  accountNumber: "DM-0007",
  settings: { invoiceStart: 5000 },
  next: {
    customer: "C-001",
    quote: "Q-001",
    invoice: "INV-5001",
    changeOrder: "CO-001",
    workOrder: "WO-001",
  },
  issued: {
    customer: false,
    quote: false,
    invoice: true,
    changeOrder: false,
    workOrder: false,
  },
  locked: true,
  ...over,
});

const form = (over: Record<string, string> = {}) => ({
  customer: "1",
  quote: "1",
  invoice: "5000",
  changeOrder: "1",
  workOrder: "1",
  ...over,
});

describe("REQ-199 numberingPatch — the PUT body from the form", () => {
  it("REQ-199 only the kinds that changed, as integers", () => {
    const { numberingPatch } = ns();
    expect(numberingPatch(view(), form({ customer: "100" }))).toEqual({
      customerStart: 100,
    });
  });

  it("REQ-199 nothing changed → an empty patch", () => {
    const { numberingPatch } = ns();
    expect(numberingPatch(view(), form())).toEqual({});
  });

  it("REQ-199 a locked kind is never in the patch even when its field changed", () => {
    const { numberingPatch } = ns();
    expect(numberingPatch(view(), form({ invoice: "9000", quote: "20" })))
      .toEqual({ quoteStart: 20 });
  });

  it("REQ-199 a digit string with spaces is an integer; blanks, decimals, zero and junk are left out", () => {
    const { numberingPatch } = ns();
    expect(
      numberingPatch(
        view(),
        form({
          customer: " 250 ",
          quote: "",
          changeOrder: "2.5",
          workOrder: "0",
        }),
      ),
    ).toEqual({ customerStart: 250 });
    expect(numberingPatch(view(), form({ quote: "abc" }))).toEqual({});
  });

  it("REQ-199 a kind with no setting compares against the default 1", () => {
    const { numberingPatch } = ns();
    expect(numberingPatch(view({ settings: {} }), form({ invoice: "5000" })))
      .toEqual({});
    expect(
      numberingPatch(
        view({ settings: {}, issued: { ...view().issued, invoice: false } }),
        form({ invoice: "5000" }),
      ),
    ).toEqual({ invoiceStart: 5000 });
  });
});

describe("REQ-199 invalidStartKinds — what the form refuses", () => {
  it("REQ-199 zero, negatives, decimals and junk are invalid; blank is not", () => {
    const { invalidStartKinds } = ns();
    expect(
      invalidStartKinds(
        form({
          customer: "0",
          quote: "-3",
          invoice: "1.5",
          changeOrder: "x",
          workOrder: "",
        }),
      ),
    ).toEqual(["customer", "quote", "invoice", "changeOrder"]);
    expect(invalidStartKinds(form())).toEqual([]);
  });
});

describe("REQ-199 labels", () => {
  it("REQ-199 startValueOf shows the setting, else 1", () => {
    const { startValueOf } = ns();
    expect(startValueOf(view(), "invoice")).toBe("5000");
    expect(startValueOf(view(), "customer")).toBe("1");
  });

  it("REQ-199 nextLabel renders 'Next: INV-5001' from the template", () => {
    const { nextLabel } = ns();
    expect(nextLabel(view(), "invoice", "Next: {number}")).toBe(
      "Next: INV-5001",
    );
    expect(nextLabel(view(), "quote", "Siguiente: {number}")).toBe(
      "Siguiente: Q-001",
    );
  });

  it("REQ-199 issuedNumberOf is the number before next, null when nothing issued", () => {
    const { issuedNumberOf } = ns();
    expect(issuedNumberOf(view(), "invoice")).toBe("INV-5000");
    expect(
      issuedNumberOf(
        view({ next: { ...view().next, invoice: "INV-002" } }),
        "invoice",
      ),
    ).toBe("INV-001");
    expect(issuedNumberOf(view(), "quote")).toBeNull();
  });

  it("REQ-199 lockNote names the issued number, empty for an open kind", () => {
    const { lockNote } = ns();
    expect(lockNote(view(), "invoice", "Locked — {number} was already issued"))
      .toBe("Locked — INV-5000 was already issued");
    expect(lockNote(view(), "customer", "Locked — {number} was already issued"))
      .toBe("");
  });

  it("REQ-199 lockedKindsMessage lists the kinds the server refused", () => {
    const { lockedKindsMessage } = ns();
    const labels = { invoice: "Invoices", quote: "Quotes" };
    expect(
      lockedKindsMessage(
        ["invoice", "quote"],
        labels,
        "Already issued, locked: {kinds}",
      ),
    )
      .toBe("Already issued, locked: Invoices, Quotes");
  });
});
