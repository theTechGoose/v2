/**
 * REQ-658 — demo-loop cycle 5 (run r37f88707), issues M17 "Assistant reply
 * fails with 200 and the error becomes the summary" and m51 "'Break down labor
 * vs materials' only re-prices".
 *
 * Cause (RCA at 2444608a): `statedPriceCents` (shared/quote-flow/step-composer.ts)
 * tested its SHARE regex — '%', deposit, upfront… — on the WHOLE message, so a
 * markup anywhere ("85/hr + cost+15%") cancelled the price the contractor
 * named elsewhere ("make it around 18k"). A share only disqualifies the amount
 * it sits next to: the sentence/clause the amount is in.
 */
import { statedPriceCents } from "../../shared/quote-flow/step-composer";

const DEMO =
  "how did you get 17,500? 85/hr + cost+15%, break down labor vs materials... make it around 18k";

describe("REQ-658 M17: a markup or share elsewhere in the message no longer cancels the stated price", () => {
  test("REQ-658: the demo's message names $18,000 for the box", () => {
    expect(statedPriceCents(DEMO)).toBe(1_800_000);
  });

  test("REQ-658: a percent or deposit in another sentence does not cancel it", () => {
    expect(statedPriceCents("I charge cost+15% on materials. make it $21k"))
      .toBe(2_100_000);
    expect(statedPriceCents("make it $21k. 30% deposit like usual"))
      .toBe(2_100_000);
  });

  test("REQ-658: a share next to the amount still disqualifies it", () => {
    expect(statedPriceCents("take a $500 deposit")).toBeNull();
    expect(statedPriceCents("make it $4,500 with 50% upfront")).toBeNull();
    expect(statedPriceCents("deposit should be around $2k")).toBeNull();
    expect(statedPriceCents("anticipo de unos $3,000")).toBeNull();
    expect(statedPriceCents("make it about 20% more, like $24k")).toBeNull();
  });
});
