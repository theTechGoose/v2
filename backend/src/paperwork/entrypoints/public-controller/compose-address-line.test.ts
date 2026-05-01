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
