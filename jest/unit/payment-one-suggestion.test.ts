/**
 * REQ-1105 — LOOP-007 cycle 3, issue q3-29: "Two 'Suggested' badges on the
 * payment step" (cites REQ-258 / REQ-265 / REQ-672). The tag was drawn for
 * the front end's parse of the message OR the server's suggestedOptionId, so
 * "30% deposit" with the model's '30_30_40' tagged two chips. One helper now
 * picks the single suggested option, and the island draws the tag from it.
 */
import * as fs from "fs";
import * as path from "path";
import {
  extractQuoteFacts,
  wizardPrefillFor,
  wizardSuggestedOption,
} from "../../shared/quote-flow/quote-facts";

const root = path.resolve(__dirname, "../..");
const island = fs.readFileSync(
  path.join(root, "front-end/islands/AsstChat.tsx"),
  "utf8",
);

describe("REQ-1105 (LOOP-007 q3, q3-29) one 'Suggested' option per wizard step", () => {
  test("REQ-1105: the message's parse (deposit_bal) wins over the model's 30_30_40", () => {
    const facts = extractQuoteFacts(
      "new quote for maria lopez, 1408 Elm St Austin TX 78702. exterior $4,850, fence $1,275.50. option 2: also pressure wash driveway $325. 30% deposit",
    );
    const prefill = wizardPrefillFor("payment_terms", facts, "en");
    expect(prefill?.optionId).toBe("deposit_bal");
    expect(wizardSuggestedOption(prefill?.optionId, "30_30_40")).toBe(
      "deposit_bal",
    );
  });

  test("REQ-1105: the server's suggestion stands when the words gave none", () => {
    expect(wizardSuggestedOption(undefined, "50_50")).toBe("50_50");
    expect(wizardSuggestedOption(undefined, undefined)).toBeUndefined();
  });

  test("REQ-1105: a rewound step suggests nothing", () => {
    expect(wizardSuggestedOption("deposit_bal", "30_30_40", true))
      .toBeUndefined();
  });

  test("REQ-1105: the island draws the tag from the one suggested id", () => {
    expect(island).toMatch(/const suggestedId = wizardSuggestedOption\(/);
    expect(island).toMatch(
      /\{suggestedId === opt\.id\s*\?\s*\(\s*<span class="wiz-opt__tag">/,
    );
    expect(island).not.toMatch(
      /prefillOpt\?\.id === opt\.id\)\s*\|\|\s*\(rewindAnswer/,
    );
  });
});
