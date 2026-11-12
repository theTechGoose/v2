import { assertEquals } from "#std/assert";
import { composeAddressLine } from "./mod.ts";

/**
 * `composeAddressLine` flattens a BusinessAddress row into a single line
 * for public-doc rendering ("On the public quote page, address under the
 * eyebrow" — audit1 #26). Branch coverage matters here: the address rows
 * we get back from contractors are routinely partial (city + state, no
 * street; postal-only; legacy rows with only the city set).
 */

Deno.test("composeAddressLine: full address renders street, city, state, postal", () => {
  assertEquals(
    composeAddressLine({ street: "123 Main St", city: "Austin", state: "TX", postal: "78701" }),
    "123 Main St, Austin, TX 78701",
  );
});

Deno.test("composeAddressLine: street + city + state, no postal", () => {
  assertEquals(
    composeAddressLine({ street: "123 Main St", city: "Austin", state: "TX" }),
    "123 Main St, Austin, TX",
  );
});

Deno.test("composeAddressLine: city + state only (no street)", () => {
  // The eyebrow line shouldn't lead with a stray comma; strip the missing
  // street segment cleanly.
  assertEquals(
    composeAddressLine({ city: "Austin", state: "TX" }),
    "Austin, TX",
  );
});

Deno.test("composeAddressLine: city-only is acceptable", () => {
  assertEquals(
    composeAddressLine({ city: "Austin" }),
    "Austin",
  );
});

Deno.test("composeAddressLine: state + postal without city renders both", () => {
  assertEquals(
    composeAddressLine({ state: "TX", postal: "78701" }),
    "TX 78701",
  );
});

Deno.test("composeAddressLine: street-only (legacy rows pre-onboarding wizard)", () => {
  assertEquals(
    composeAddressLine({ street: "123 Main St" }),
    "123 Main St",
  );
});

Deno.test("composeAddressLine: empty address row returns undefined", () => {
  assertEquals(composeAddressLine({}), undefined);
});

Deno.test("composeAddressLine: null/undefined input returns undefined", () => {
  assertEquals(composeAddressLine(null), undefined);
  assertEquals(composeAddressLine(undefined), undefined);
});

Deno.test("composeAddressLine: whitespace-only fields treated as missing", () => {
  // Trim contract: " 123 Main St " becomes the rendered value, but a
  // bare "  " or empty string contributes nothing to the line.
  assertEquals(
    composeAddressLine({ street: "  ", city: "Austin", state: "TX" }),
    "Austin, TX",
  );
  assertEquals(
    composeAddressLine({ street: "", city: "", state: "", postal: "" }),
    undefined,
  );
});

Deno.test("composeAddressLine: leading/trailing whitespace on real values is trimmed", () => {
  assertEquals(
    composeAddressLine({ street: "  123 Main St  ", city: " Austin ", state: " TX ", postal: " 78701 " }),
    "123 Main St, Austin, TX 78701",
  );
});

// REQ-420 (demo-loop cycle 2, issue m28): rows saved before the save path split
// one-line streets still hold the whole address in `street` — the line must not
// repeat the state (or ZIP / city) the street already ends with.
Deno.test("REQ-420 m28: a street that already ends with 'City, ST ZIP' is not followed by the state again", () => {
  assertEquals(
    composeAddressLine({ street: "1200 E Cesar Chavez St, Austin, TX 78702", state: "TX" }),
    "1200 E Cesar Chavez St, Austin, TX 78702",
  );
  assertEquals(
    composeAddressLine({
      street: "1200 E Cesar Chavez St, Austin, TX 78702",
      city: "Austin",
      state: "TX",
      postal: "78702",
    }),
    "1200 E Cesar Chavez St, Austin, TX 78702",
  );
  assertEquals(
    composeAddressLine({ street: "1200 E Cesar Chavez St, Austin, Texas", state: "TX" }),
    "1200 E Cesar Chavez St, Austin, Texas",
  );
  assertEquals(
    composeAddressLine({ street: "1200 E Cesar Chavez St, Austin, TX 78702", state: "tx" }),
    "1200 E Cesar Chavez St, Austin, TX 78702",
  );
});

Deno.test("REQ-420 m28: a street that merely contains the state's letters still gets the city/state half", () => {
  assertEquals(
    composeAddressLine({ street: "12 Texas Ave", city: "Houston", state: "TX", postal: "77002" }),
    "12 Texas Ave, Houston, TX 77002",
  );
  assertEquals(
    composeAddressLine({ street: "5 Tx Rd", city: "Austin", state: "TX" }),
    "5 Tx Rd, Austin, TX",
  );
});
