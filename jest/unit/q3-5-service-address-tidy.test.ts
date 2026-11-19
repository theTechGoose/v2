/**
 * REQ-1088 — LOOP-007 cycle 3, issues q3-5 [BUG_CONTRADICTION] "Stored quote
 * service address is not tidied (no commas, lowercase)" and q3-6
 * [BUG_POLISH] "Invoice service address not tidied".
 *
 * `tidyServiceAddress` (shared/customer-address/mod.ts, REQ-1047) only adds
 * ", " before the city and the state when the WHOLE input is lower case and
 * has no comma (`reformat = !/\p{Lu}/u.test(s) && !s.includes(",")`). The
 * testers typed ordinary mixed-case addresses with no commas, or with a comma
 * after the street only, and every one came back byte-identical:
 *   QA1 "2210 Burnet Rd Austin TX 78757"
 *   QA2 "1408 Elm St Austin TX 78702", "455 Calle Oak, San Antonio TX 78210"
 *   QA3 "4410 avenue h, austin tx 78751" → "4410 Avenue H, Austin TX 78751"
 * The commas must follow the address's structure (a recognised state before
 * the ZIP, a street-type word ending the street), not its letter case.
 */

// deno-lint-ignore no-explicit-any
let addr: any;
beforeAll(() => {
  addr = require("../../shared/customer-address/mod");
});

const tidy = (s: string): string => addr.tidyServiceAddress(s);

describe("REQ-1088 q3-5 tidyServiceAddress — a mixed-case typed address gets its commas", () => {
  test("REQ-1088 QA1 '2210 Burnet Rd Austin TX 78757' → '2210 Burnet Rd, Austin, TX 78757'", () => {
    expect(tidy("2210 Burnet Rd Austin TX 78757")).toBe(
      "2210 Burnet Rd, Austin, TX 78757",
    );
  });

  test("REQ-1088 QA2 '1408 Elm St Austin TX 78702' → '1408 Elm St, Austin, TX 78702'", () => {
    expect(tidy("1408 Elm St Austin TX 78702")).toBe(
      "1408 Elm St, Austin, TX 78702",
    );
  });

  test("REQ-1088 QA2 '455 Calle Oak, San Antonio TX 78210' (a comma after the street only) → '455 Calle Oak, San Antonio, TX 78210'", () => {
    expect(tidy("455 Calle Oak, San Antonio TX 78210")).toBe(
      "455 Calle Oak, San Antonio, TX 78210",
    );
  });

  test("REQ-1088 the customer record's lowercase '12 oak st, myrtle beach, sc 29577' → '12 Oak St, Myrtle Beach, SC 29577'", () => {
    expect(tidy("12 oak st, myrtle beach, sc 29577")).toBe(
      "12 Oak St, Myrtle Beach, SC 29577",
    );
  });
});

describe("REQ-1088 q3-6 tidyServiceAddress — the invoice address QA3 typed", () => {
  test("REQ-1088 QA3 '4410 avenue h, austin tx 78751' → '4410 Avenue H, Austin, TX 78751'", () => {
    expect(tidy("4410 avenue h, austin tx 78751")).toBe(
      "4410 Avenue H, Austin, TX 78751",
    );
  });

  test("REQ-1088 QA5 '45 palmetto dr, conway, SC 29526' → '45 Palmetto Dr, Conway, SC 29526'", () => {
    expect(tidy("45 palmetto dr, conway, SC 29526")).toBe(
      "45 Palmetto Dr, Conway, SC 29526",
    );
  });
});

describe("REQ-1088 tidyServiceAddress — a formatted address is never rewritten", () => {
  test("REQ-1088 formatted addresses come back exactly as they were", () => {
    for (
      const ok of [
        "12 Oak St, Austin, TX 78701",
        "2210 Burnet Rd, Austin, TX 78757",
        "455 Calle Oak, San Antonio, TX 78210",
        "123 McKinney Ave, Austin, TX",
        "412 Oak St Austin",
      ]
    ) {
      expect(tidy(ok)).toBe(ok);
    }
  });
});
