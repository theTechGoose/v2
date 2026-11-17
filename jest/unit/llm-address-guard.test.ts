/**
 * REQ-418 — demo-loop cycle 2, issue M27: "Client form prefills the phone
 * number into the job address". The contractor typed
 * "Cotización rápida: reparar puerta de baño para Maria Lopez, 512-555-0199,
 * $250"; the model's create_quote `serviceAddress` came back as the phone,
 * the server stored it unchecked and the customer step's "Dirección del
 * trabajo" box was seeded with "512-555-0199".
 *
 * Here: the pure guard (shared/quote-flow/quick-quote-prefill.ts) that the
 * tool parser and the chat coordinator run the model's value through, and
 * the tightened tool description in both dictionaries.
 */
import * as fs from "fs";
import * as path from "path";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const DEMO =
  "Cotización rápida: reparar puerta de baño para Maria Lopez, 512-555-0199, $250";

describe("REQ-418 (demo M27) the model's serviceAddress is checked before it is kept", () => {
  let mod: any;
  beforeAll(() => {
    mod = require("../../shared/quote-flow/quick-quote-prefill");
  });

  it("REQ-418 the demo's sentence has no address the extractor can see", () => {
    expect(mod.extractServiceAddress(DEMO)).toBeNull();
  });

  it("REQ-418 a phone number is never an address — not even one the user typed", () => {
    for (
      const v of [
        "512-555-0199",
        "(512) 555-0199",
        "+1 512 555 0199",
        "5125550199",
        "Maria Lopez, 512-555-0199",
      ]
    ) {
      expect(mod.isAddressShaped(v)).toBe(false);
      expect(mod.acceptModelServiceAddress(v, [DEMO])).toBeNull();
    }
  });

  it("REQ-418 an email, or a value with no letters, is never an address", () => {
    for (
      const v of [
        "maria@lopez.com",
        "Maria <maria@lopez.com>",
        "$250",
        "250",
        "  ",
      ]
    ) {
      expect(mod.isAddressShaped(v)).toBe(false);
    }
  });

  it("REQ-418 a real address is address-shaped — a ZIP+4 is not a phone", () => {
    for (
      const v of [
        "412 Oak St Austin",
        "412 Oak St, Austin TX 78701-1234",
        "Calle Elm 512",
      ]
    ) {
      expect(mod.isAddressShaped(v)).toBe(true);
    }
  });

  it("REQ-418 a model address nobody typed is dropped (invented)", () => {
    expect(
      mod.acceptModelServiceAddress("412 Oak St, Austin TX", [
        "Deep clean for Maria Lopez at her place, $350",
      ]),
    ).toBeNull();
  });

  it("REQ-418 a model address grounded in a user turn is kept, even reworded", () => {
    expect(
      mod.acceptModelServiceAddress("412 Oak St, Austin TX", [
        "Deep clean for Maria Lopez at 412 oak st in austin, $350",
      ]),
    ).toBe("412 Oak St, Austin TX");
  });

  it("REQ-418 the create_quote serviceAddress description says never a phone number or email (en + es)", () => {
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(read(`lang/${lang}.json`));
      expect(dict["prompts.tools.createQuote.serviceAddress"]).toMatch(
        /never a phone number or email/,
      );
    }
  });
});
