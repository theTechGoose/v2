/**
 * REQ-680 — fix every issue the demo found (demo-loop cycle 5); these are demo issues
 *   - M25 "Negative price silently turned positive; quote sent at $1,850": typing "-1850" into the
 *     Amount pad left "1,850" with no word, and "price -500 dollars" in the chat sentence seeded
 *     the pad at $500.
 *   - m62 "'abc' in Amount field gives no message": letters emptied the field and only greyed
 *     Continue out.
 *
 * RCA: front-end/lib/money-input.ts strips every non-digit/dot (REQ-280) and reported nothing;
 * shared/quote-flow/money-amounts.ts NUM has no sign, so "-500 dollars" read as 500.
 * The fix: typeMoney returns `rejected` ('minus' | 'letters' | null) for MoneyInput's note; the
 * money reader flags a negative amount and the quick-quote prefill skips it (the price step
 * says why).
 */
import { typeMoney } from "../../front-end/lib/money-input";
import { moneyAmounts } from "../../shared/quote-flow/money-amounts";
import {
  extractPriceCents,
  extractPriceLines,
  extractQuickQuotePrefill,
  negativePriceCents,
} from "../../shared/quote-flow/quick-quote-prefill";

const typed = (value: string) =>
  typeMoney({ value, selectionStart: value.length });

describe("REQ-680 (demo M25 + m62): typeMoney says what it dropped", () => {
  test("REQ-680 M25: a minus is flagged 'minus' — '-1850' is still 1,850 but not silently", () => {
    const r = typed("-1850");
    expect(r.formatted).toBe("1,850");
    expect(r.cents).toBe(185000);
    expect(r.rejected).toBe("minus");
  });

  test("REQ-680 M25: a minus typed into a filled field, and a unicode minus, are flagged", () => {
    expect(typeMoney({ value: "-50", selectionStart: 1 }).rejected).toBe(
      "minus",
    );
    expect(typed("−1850").rejected).toBe("minus");
  });

  test("REQ-680 m62: letters are flagged 'letters' — 'abc' empties the field with a reason", () => {
    const r = typed("abc");
    expect(r.formatted).toBe("");
    expect(r.cents).toBeNull();
    expect(r.rejected).toBe("letters");
    expect(typed("50x").rejected).toBe("letters");
  });

  test("REQ-680: a minus wins over letters ('-50abc' is about the sign)", () => {
    expect(typed("-5a").rejected).toBe("minus");
  });

  test("REQ-680: a valid keystroke clears it — digits, the dot, the formatter's commas, a typed $", () => {
    expect(typed("1,8505").rejected).toBeNull();
    expect(typed("12.5").rejected).toBeNull();
    expect(typed("$40").rejected).toBeNull();
    expect(typed("").rejected).toBeNull();
    expect(typed("1 000").rejected).toBeNull();
  });
});

describe("REQ-680 (demo M25): a negative amount in the sentence never seeds the price", () => {
  const DEMO =
    "panel upgrade for Bob Miller, price -500 dollars, email notanemail";

  test("REQ-680 M25: moneyAmounts flags '-500 dollars', '-$500', '$-500' and 'minus $500' as negative", () => {
    for (
      const s of [
        DEMO,
        "fence repair -$500",
        "fence repair $-500 dollars",
        "fence repair minus $500",
        "fence repair, minus 500 dollars",
      ]
    ) {
      const a = moneyAmounts(s);
      expect(a).toHaveLength(1);
      expect(a[0].cents).toBe(50000);
      expect(a[0].negative).toBe(true);
    }
  });

  test("REQ-680: a range or a hyphenated phrase is not a minus", () => {
    const range = moneyAmounts("between $3,000 - $4,000");
    expect(range.map((a) => a.negative)).toEqual([false, false]);
    expect(moneyAmounts("$3,000-$4,000").map((a) => a.negative)).toEqual([
      false,
      false,
    ]);
    expect(moneyAmounts("all-in $18,500")[0].negative).toBe(false);
    expect(moneyAmounts("re-roof $9,000")[0].negative).toBe(false);
  });

  test("REQ-680 M25: extractPriceCents skips the prefill; negativePriceCents names the amount", () => {
    expect(extractPriceCents(DEMO)).toBeNull();
    expect(negativePriceCents(DEMO)).toBe(50000);
    const p = extractQuickQuotePrefill(DEMO);
    expect(p.priceCents).toBeNull();
    expect(p.lines).toEqual([]);
    expect(extractPriceLines("demo $2,500, credit -$500")).toEqual([]);
  });

  test("REQ-680: a positive price is untouched", () => {
    expect(extractPriceCents("deck stain for Ann, $1,850 all in")).toBe(185000);
    expect(negativePriceCents("deck stain for Ann, $1,850 all in")).toBeNull();
    expect(extractPriceCents("between $3,000 - $4,000")).toBe(400000);
  });
});
