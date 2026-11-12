/**
 * REQ-241 (demo issue quote-invoice-money-m1) — one quote, one number. The
 * assistant's review card shows the quote's REQ-198 number ("Q-001"), the
 * same one the documents carry, not the id's hex prefix ("#0FF68427"); the
 * hex survives only for a row that has no number.
 */
import * as fs from "fs";
import * as path from "path";
import { reviewCardNumber } from "../../shared/documents/numbering";

const ASST = fs.readFileSync(
  path.join(__dirname, "../../front-end/islands/AsstChat.tsx"),
  "utf8",
);

describe("REQ-241 review card number", () => {
  test("REQ-241 the fetched quote's number is what the card shows", () => {
    expect(
      reviewCardNumber("0ff68427-aaaa-bbbb-cccc-dddddddddddd", {
        id: "0ff68427-aaaa-bbbb-cccc-dddddddddddd",
        number: "Q-001",
      }),
    ).toBe("Q-001");
    expect(
      reviewCardNumber("abc", { id: "abc", number: "SAMPLE" }),
    ).toBe("SAMPLE");
  });

  test("REQ-241 the hex fallback only when no number is known for that id", () => {
    const id = "0ff68427-aaaa-bbbb-cccc-dddddddddddd";
    expect(reviewCardNumber(id, null)).toBe("#0FF68427");
    expect(reviewCardNumber(id, { id })).toBe("#0FF68427");
    // a quote fetched for a different id never lends its number
    expect(reviewCardNumber(id, { id: "other", number: "Q-009" })).toBe(
      "#0FF68427",
    );
  });

  test("REQ-241 AsstChat's review card renders reviewCardNumber, not the id's hex", () => {
    expect(ASST).not.toMatch(/#\{docId\.slice\(0,\s*8\)\.toUpperCase\(\)\}/);
    expect(ASST).toMatch(/reviewCardNumber\(\s*docId,\s*quote/);
  });
});
