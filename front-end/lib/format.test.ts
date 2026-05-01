import { assertEquals } from "@std/assert";
import { fmtMoney, fmtMoneyExact, fmtMoneyShort, fmtPhone, telHref } from "./format.ts";

/**
 * Pins the cents-input contract for the money formatters (audit1 #3).
 *
 * If anyone ever "fixes" these back to dollar-input, every renderer in
 * the app silently shows 1/100th of the truth — these tests fail loudly
 * before that drift can land.
 */

Deno.test("fmtMoney: integer cents → no-decimal dollars with $", () => {
  assertEquals(fmtMoney(150_00), "$150");
  assertEquals(fmtMoney(1_000_00), "$1,000");
  assertEquals(fmtMoney(99_999_99), "$100,000");           // rounds .99 cents → next dollar
  assertEquals(fmtMoney(0), "$0");
});

Deno.test("fmtMoney: rounds half cents up to nearest dollar", () => {
  assertEquals(fmtMoney(150_50), "$151");                  // .50 → up
  assertEquals(fmtMoney(150_49), "$150");                  // .49 → down
  assertEquals(fmtMoney(99), "$1");                        // 99¢ → $1
  assertEquals(fmtMoney(50), "$1");                        // 50¢ → $1 (banker rounding-aware: Math.round picks .5 → +∞)
  assertEquals(fmtMoney(49), "$0");                        // 49¢ → $0
});

Deno.test("fmtMoney: handles negative cents (refund / overpayment balances)", () => {
  assertEquals(fmtMoney(-500_00), "-$500");
  assertEquals(fmtMoney(-50), "-$1");                      // -50¢ → -$1 (Math.round(-0.5) = 0 in JS, but we Math.round(-50/100)=-1; pin actual behavior)
});

Deno.test("fmtMoney: bad input falls back to $0 (never crashes the render)", () => {
  assertEquals(fmtMoney(undefined), "$0");
  assertEquals(fmtMoney(null), "$0");
  assertEquals(fmtMoney(NaN), "$0");
  assertEquals(fmtMoney(Infinity), "$0");
  assertEquals(fmtMoney(-Infinity), "$0");
});

Deno.test("fmtMoneyShort: alias of fmtMoney (same identity contract)", () => {
  assertEquals(fmtMoneyShort, fmtMoney);
  assertEquals(fmtMoneyShort(2_500_00), "$2,500");
});

Deno.test("fmtMoneyExact: integer cents → 2-decimal dollars with $", () => {
  assertEquals(fmtMoneyExact(150_00), "$150.00");
  assertEquals(fmtMoneyExact(150_50), "$150.50");
  assertEquals(fmtMoneyExact(150_49), "$150.49");
  assertEquals(fmtMoneyExact(0), "$0.00");
  assertEquals(fmtMoneyExact(99), "$0.99");                // sub-dollar amounts render correctly
  assertEquals(fmtMoneyExact(1_234_567_89), "$1,234,567.89");
});

Deno.test("fmtMoneyExact: bad input → em-dash placeholder (not $0.00)", () => {
  // Distinct from fmtMoney's "$0" — document totals show "—" so a missing
  // value reads as "we don't know" rather than "the amount is zero".
  assertEquals(fmtMoneyExact(undefined), "—");
  assertEquals(fmtMoneyExact(null), "—");
  assertEquals(fmtMoneyExact(NaN), "—");
  assertEquals(fmtMoneyExact(Infinity), "—");
});

Deno.test("fmtMoneyExact: handles negative cents", () => {
  assertEquals(fmtMoneyExact(-150_00), "-$150.00");
});

Deno.test("fmtPhone: US 10-digit shapes to (NPA) NXX-XXXX", () => {
  assertEquals(fmtPhone("5125550000"), "(512) 555-0000");
  assertEquals(fmtPhone("+15125550000"), "(512) 555-0000");
  assertEquals(fmtPhone("15125550000"), "(512) 555-0000");
});

Deno.test("fmtPhone: non-NANP / unparseable returns input unchanged", () => {
  assertEquals(fmtPhone(""), "");
  assertEquals(fmtPhone(undefined), "");
  assertEquals(fmtPhone(null), "");
  assertEquals(fmtPhone("+44 20 7946 0958"), "+44 20 7946 0958");  // not NANP, passthrough
});

Deno.test("telHref: 10-digit US gets +1 prefix; already-+ pass-through", () => {
  assertEquals(telHref("5125550000"), "tel:+15125550000");
  assertEquals(telHref("+15125550000"), "tel:+15125550000");
  assertEquals(telHref("15125550000"), "tel:+15125550000");
  assertEquals(telHref(""), "");
});
