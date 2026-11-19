/**
 * REQ-979 (LOOP-007 q1, issue q1-59) — the New invoice's Amount box is locked
 * only by rows that actually bill a service. The form opens with one empty
 * row, and serviceRowsToLines drops a row with no service, so locking on the
 * raw row count left Amount read-only while the Subtotal read $0.00.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/documents/service-lines");

const row = (name: string, price: string, serviceId = name ? "t1" : "") => ({
  serviceId,
  name,
  price,
});

describe("REQ-979 q1-59 Amount lock follows the rows that bill", () => {
  it("REQ-979 shared/documents/service-lines exports amountLocked(rows)", () => {
    expect(typeof mod().amountLocked).toBe("function");
  });

  it("REQ-979 an untouched empty row, or a price with no service picked, leaves Amount editable", () => {
    const { amountLocked } = mod();
    expect(amountLocked([row("", "")])).toBe(false);
    expect(amountLocked([row("", "65")])).toBe(false);
    expect(amountLocked([])).toBe(false);
  });

  it("REQ-979 a row with a picked service locks Amount (its subtotal is the lines')", () => {
    const { amountLocked } = mod();
    expect(amountLocked([row("Lawn mowing", "65")])).toBe(true);
    expect(amountLocked([row("", "10"), row("Edging", "")])).toBe(true);
  });

  it("REQ-979 amountLocked agrees with serviceRowsToLines for every shape", () => {
    const { amountLocked, serviceRowsToLines } = mod();
    const shapes = [
      [],
      [row("", "")],
      [row("", "65")],
      [row("  ", "65", "")],
      [row("Mowing", "")],
      [row("", ""), row("Mowing", "40")],
    ];
    for (const rows of shapes) {
      expect(amountLocked(rows)).toBe(serviceRowsToLines(rows).length > 0);
    }
  });
});
