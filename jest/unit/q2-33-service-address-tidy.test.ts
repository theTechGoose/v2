/**
 * REQ-1047 — LOOP-007 cycle 2, issue q2-33 [BUG_POLISH]: "Q-002 service
 * address kept raw lowercase on the customer /q page" while Q-001's was
 * formatted.
 *
 * The tester typed both addresses all in lowercase:
 *   Q-001 "1418 oak hollow dr austin tx 78745"
 *   Q-002 "905 calle del sol san antonio tx 78207"
 * `extractServiceAddress` (shared/quote-flow/quick-quote-prefill.ts) reads
 * neither (every branch needs capital letters), so the stored address is the
 * model's `serviceAddress`, which `acceptModelServiceAddress` only grounds and
 * returns untouched. Whether the customer sees a tidy address depends on what
 * the model happened to do. Nothing normalizes a quote's service address.
 *
 * The fix: a pure `tidyServiceAddress(s)` in shared/customer-address/mod.ts
 * (title-cases lowercase words, keeps Spanish connectors and already mixed /
 * upper case words, uppercases the 2-letter state, keeps the ZIP), run on
 * every stored quote.serviceAddress.
 */

// deno-lint-ignore no-explicit-any
let addr: any;
// deno-lint-ignore no-explicit-any
let prefill: any;
beforeAll(() => {
  addr = require("../../shared/customer-address/mod");
  prefill = require("../../shared/quote-flow/quick-quote-prefill");
});

// the exact messages from the run (demo-loop r66a3e3fc fleet-1, #1 and #4)
const Q001 =
  "quote for maria gonzalez 843-555-0142 maria.g@example.com, 1418 oak hollow dr austin tx 78745. master bath redo, tear out old tub put in walk in shower w/ tile surround about 60 sqft wall tile + 35 sqft floor, new 48in vanity, 2 options: basic porcelain tile $8,400 or upgrade with niche + glass door $11,200. 30% deposit";
const Q002 =
  "cotizacion para jorge ramirez tel 843 555 2290, 905 calle del sol san antonio tx 78207. pintar la casa por fuera, mano de obra 4200 materiales 1350. 50% de anticipo. y tambien arreglar la cerca de madera 18 pies lineales $900";

const tidy = (s: string): string => {
  expect(typeof addr.tidyServiceAddress).toBe("function");
  return addr.tidyServiceAddress(s);
};

describe("REQ-1047 q2-33 tidyServiceAddress — a typed address is stored tidy, whatever the model did", () => {
  test("REQ-1047 Q-001's lowercase '1418 oak hollow dr austin tx 78745' → '1418 Oak Hollow Dr, Austin, TX 78745'", () => {
    expect(tidy("1418 oak hollow dr austin tx 78745")).toBe(
      "1418 Oak Hollow Dr, Austin, TX 78745",
    );
  });

  test("REQ-1047 Q-002's Spanish '905 calle del sol san antonio tx 78207' is title-cased, 'del' kept, state upper case", () => {
    expect(tidy("905 calle del sol san antonio tx 78207")).toMatch(
      /^905 Calle del Sol,? San Antonio,? TX 78207$/,
    );
  });

  test("REQ-1047 an already-formatted address is left exactly as it is", () => {
    for (
      const ok of [
        "1418 Oak Hollow Dr, Austin, TX 78745",
        "905 Calle del Sol, San Antonio, TX 78207",
        "4410 Avenue F Austin TX 78751",
        "123 McKinney Ave, Austin, TX",
      ]
    ) {
      expect(tidy(ok)).toBe(ok);
    }
  });
});

describe("REQ-1047 q2-33 the exact typed sentences reach a tidy service address", () => {
  // The coordinator stores `extracted || acceptModelServiceAddress(...)`.
  // Whichever source wins, the value a customer sees must be tidy. The model
  // on Q-002 copied the raw lowercase text — run the same pipeline here.
  const stored = (sentence: string, modelValue: string): string | null => {
    const extracted = prefill.extractServiceAddress(sentence);
    const chosen = extracted ||
      prefill.acceptModelServiceAddress(modelValue, [sentence]) || null;
    return chosen && typeof addr.tidyServiceAddress === "function"
      ? addr.tidyServiceAddress(chosen)
      : chosen;
  };

  test("REQ-1047 Q-002: the model's raw '905 calle del sol san antonio tx 78207' is stored title-cased with TX", () => {
    expect(stored(Q002, "905 calle del sol san antonio tx 78207")).toMatch(
      /^905 Calle del Sol,? San Antonio,? TX 78207$/,
    );
  });

  test("REQ-1047 Q-001: the model's raw '1418 oak hollow dr austin tx 78745' is stored as '1418 Oak Hollow Dr, Austin, TX 78745'", () => {
    expect(stored(Q001, "1418 oak hollow dr austin tx 78745")).toBe(
      "1418 Oak Hollow Dr, Austin, TX 78745",
    );
  });
});
