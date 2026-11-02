/**
 * REQ-127 — Raphael, 2026-11-02: "alex paid $99 … when he upgrades its trying to charge him 399
 * not 300 for the difference." / "upgrade charges the difference, downgrade has no refund".
 *
 * The ONE rule of a plan switch, read by the backend (what the due is) and drawn by the Billing
 * tab (what the card says it will do): shared/quote-flow/plan-switch.ts.
 */
import { addMonth, switchQuote } from "../../shared/quote-flow/plan-switch";

const NOW = "2026-11-02T15:00:00.000Z";
const active = (planId: string, nextBillAt?: string) => ({ planId, status: "active" as const, nextBillAt });

describe("REQ-127 plan switch", () => {
  test("REQ-127 an upgrade from an active plan is the difference of the two prices, billed at the new price from the old billing's next bill (REQ-129)", () => {
    expect(switchQuote(active("monster", "2026-11-20T15:00:00.000Z"), "assist-plus", NOW)).toEqual({
      kind: "upgrade",
      dueCents: 30000,
      monthlyCents: 39900,
      firstBillAt: "2026-11-20T15:00:00.000Z",
      fromPlanId: "monster",
    });
    expect(switchQuote(active("monster"), "assist", NOW).dueCents).toBe(10000);
    expect(switchQuote(active("assist"), "assist-plus", NOW).dueCents).toBe(20000);
  });

  test("REQ-127 a downgrade from an active plan charges nothing and refunds nothing: the cheaper billing starts the day the old one would have billed", () => {
    expect(switchQuote(active("assist-plus", "2026-11-20T15:00:00.000Z"), "monster", NOW)).toEqual({
      kind: "downgrade",
      dueCents: 0,
      monthlyCents: 9900,
      firstBillAt: "2026-11-20T15:00:00.000Z",
      fromPlanId: "assist-plus",
    });
    // the next bill unknown (the CRM never answered): the next 1st (REQ-129), never today
    expect(switchQuote(active("assist-plus"), "monster", NOW).firstBillAt).toBe("2026-12-01T00:00:00.000Z");
  });

  test("REQ-127 from free, from a pending pick, from past due, and to or from the one-time test tier it is a first pick at full price", () => {
    const first = (current: Parameters<typeof switchQuote>[0], target: string, cents: number) => {
      const q = switchQuote(current, target, NOW);
      expect(q).toEqual({ kind: "first", dueCents: cents, monthlyCents: cents, firstBillAt: null, fromPlanId: null });
    };
    first(null, "monster", 9900);
    first({ planId: "free", status: "free" }, "assist-plus", 39900);
    first({ planId: "monster", status: "pending" }, "assist-plus", 39900);
    first({ planId: "monster", status: "past_due" }, "assist-plus", 39900);
    first(active("monster"), "test", 100);
    first({ planId: "test", status: "active" }, "monster", 9900);
  });

  test("REQ-127 back to free is its own kind: nothing charged (REQ-056/061 stop the billing, no refund)", () => {
    expect(switchQuote(active("monster", "2026-11-20T15:00:00.000Z"), "free", NOW)).toEqual({
      kind: "free",
      dueCents: 0,
      monthlyCents: 0,
      firstBillAt: null,
      fromPlanId: "monster",
    });
    expect(switchQuote(null, "free", NOW).kind).toBe("free");
  });

  test("REQ-127 the plan already active is 'same' — nothing to charge, nothing to start", () => {
    expect(switchQuote(active("monster"), "monster", NOW)).toEqual({ kind: "same", dueCents: 0, monthlyCents: 9900, firstBillAt: null, fromPlanId: "monster" });
  });

  test("REQ-127 a plan not on the list is refused by name", () => {
    expect(() => switchQuote(null, "platinum", NOW)).toThrow(/plan-unknown: platinum/);
  });

  test("addMonth — a calendar month later, same day and time; a day the next month lacks lands on its last", () => {
    expect(addMonth("2026-01-31T10:00:00.000Z")).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonth("2026-11-02T15:00:00.000Z")).toBe("2026-12-02T15:00:00.000Z");
  });
});

/**
 * REQ-129 — Raphael, 2026-11-02: "subscriptions should charge $399 whenever it happens, then on
 * the 1st of the month prorated then every month $399." The full month on the day of the pick
 * pays through a calendar month later; the billing anchors to the 1st: the next 1st bills the
 * days past paidThrough at the month's rate, every 1st after it the full price.
 */
import { anchoredSchedule, firstOfNextMonth, proratedCents, switchedSchedule } from "../../shared/quote-flow/plan-switch";

describe("REQ-129 the calendar-anchored billing", () => {
  test("REQ-129 the first bill falls on the 1st of the month after the pick, 00:00 UTC", () => {
    expect(firstOfNextMonth("2026-11-20T15:00:00.000Z")).toBe("2026-12-01T00:00:00.000Z");
    expect(firstOfNextMonth("2026-12-31T23:59:59.000Z")).toBe("2027-01-01T00:00:00.000Z");
    expect(firstOfNextMonth("2026-11-01T00:00:00.000Z")).toBe("2026-12-01T00:00:00.000Z");
  });

  test("REQ-129 the prorated amount is the month's rate for the days from paidThrough to the month's end; paid through the 1st is the whole month", () => {
    expect(proratedCents(39900, "2026-12-20T15:00:00.000Z")).toBe(15445); // Dec 20–31: 12 of 31 days, $154.45
    expect(proratedCents(9900, "2026-12-02T15:00:00.000Z")).toBe(9581); // Dec 2–31: 30 of 31 days
    expect(proratedCents(39900, "2026-12-01T00:00:00.000Z")).toBe(39900); // the whole month
    expect(proratedCents(39900, "2027-02-28T10:00:00.000Z")).toBe(1425); // the last day of February: 1 of 28
  });

  test("REQ-129 a first pick: paid through a month later, billed on the next 1st for the days past that, then the full price", () => {
    expect(anchoredSchedule("2026-11-20T15:00:00.000Z", 39900)).toEqual({
      paidThrough: "2026-12-20T15:00:00.000Z",
      firstBillAt: "2026-12-01T00:00:00.000Z",
      firstAmountCents: 15445,
    });
    // picked on the 1st: paid through the next 1st, so the first bill is the whole month
    expect(anchoredSchedule("2026-11-01T00:00:00.000Z", 9900)).toEqual({
      paidThrough: "2026-12-01T00:00:00.000Z",
      firstBillAt: "2026-12-01T00:00:00.000Z",
      firstAmountCents: 9900,
    });
  });

  test("REQ-129 a switch keeps the anchor: the new billing's first bill is the old one's next, prorated at the new price before the first collection, the full new price after", () => {
    // Monster paid Nov 2 (through Dec 2), upgraded to Monster Assist+ on Nov 10: Dec 1 bills $399 for Dec 2–31
    expect(switchedSchedule({ nextBillAt: "2026-12-01T00:00:00.000Z", paidThrough: "2026-12-02T15:00:00.000Z" }, 39900, "2026-11-10T15:00:00.000Z")).toEqual({
      firstBillAt: "2026-12-01T00:00:00.000Z",
      firstAmountCents: 38613, // 30 of 31 days
    });
    // the old billing already collected its prorated first bill (its next is past paidThrough): the next 1st is a full month
    expect(switchedSchedule({ nextBillAt: "2027-01-01T00:00:00.000Z", paidThrough: "2026-12-02T15:00:00.000Z" }, 9900, "2026-12-15T15:00:00.000Z")).toEqual({
      firstBillAt: "2027-01-01T00:00:00.000Z",
      firstAmountCents: 9900,
    });
    // a plan from before the anchor (no paidThrough): the old billing's next, the full price — REQ-127 as it was
    expect(switchedSchedule({ nextBillAt: "2026-12-20T15:00:00.000Z" }, 9900, "2026-12-15T15:00:00.000Z")).toEqual({
      firstBillAt: "2026-12-20T15:00:00.000Z",
      firstAmountCents: 9900,
    });
    // the CRM never said when the old one bills next: the next 1st from now, prorated from paidThrough when it falls in that month
    expect(switchedSchedule({ paidThrough: "2026-12-02T15:00:00.000Z" }, 39900, "2026-11-10T15:00:00.000Z")).toEqual({
      firstBillAt: "2026-12-01T00:00:00.000Z",
      firstAmountCents: 38613,
    });
    expect(switchedSchedule({}, 39900, "2026-11-10T15:00:00.000Z")).toEqual({
      firstBillAt: "2026-12-01T00:00:00.000Z",
      firstAmountCents: 39900,
    });
    // the old billing's next is already behind the switch (collected meanwhile): the next 1st, the full price
    expect(switchedSchedule({ nextBillAt: "2026-12-01T00:00:00.000Z", paidThrough: "2026-12-02T15:00:00.000Z" }, 39900, "2026-12-03T15:00:00.000Z")).toEqual({
      firstBillAt: "2027-01-01T00:00:00.000Z",
      firstAmountCents: 39900,
    });
  });

  test("REQ-129 an upgrade's quote carries the old billing's next bill as the new billing's first", () => {
    expect(switchQuote(active("monster", "2026-12-01T00:00:00.000Z"), "assist-plus", NOW).firstBillAt).toBe("2026-12-01T00:00:00.000Z");
    expect(switchQuote(active("monster"), "assist-plus", NOW).firstBillAt).toBeNull();
  });
});
