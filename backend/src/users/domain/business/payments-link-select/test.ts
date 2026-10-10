import { assertEquals, assertThrows } from "#std/assert";
import { selectPaymentsLinkName } from "./mod.ts";

// REQ-054 — production must never silently boot on the fake link builder (the REQ-001 rule).
// REQ-069 — the CRM's merchant account (PPWK_PAYMENTS_ACCOUNT) is the third key: without it
// the real client could not name the `x-account` the CRM requires on every mint.

const ALL = { PPWK_PAYMENTS_URL: "https://crm.test", PPWK_PAYMENTS_TOKEN: "t", PPWK_PAYMENTS_ACCOUNT: "primary" };

Deno.test("REQ-054/069 selectPaymentsLinkName: the three CRM keys set → crm, in or out of production", () => {
  assertEquals(selectPaymentsLinkName(ALL), "crm");
  assertEquals(selectPaymentsLinkName({ ...ALL, DENO_DEPLOYMENT_ID: "abc" }), "crm");
});

Deno.test("REQ-054/069 selectPaymentsLinkName: a key missing outside production → fake (the gate's lanes and a dev box)", () => {
  assertEquals(selectPaymentsLinkName({}), "fake");
  assertEquals(selectPaymentsLinkName({ PPWK_PAYMENTS_URL: "https://crm.test" }), "fake");
  assertEquals(selectPaymentsLinkName({ PPWK_PAYMENTS_TOKEN: "t", PPWK_PAYMENTS_URL: "  " }), "fake");
  assertEquals(selectPaymentsLinkName({ PPWK_PAYMENTS_URL: "https://crm.test", PPWK_PAYMENTS_TOKEN: "t" }), "fake", "REQ-069: url + token without the account is still the fake");
  assertEquals(selectPaymentsLinkName({ ...ALL, PPWK_PAYMENTS_ACCOUNT: "  " }), "fake");
});

Deno.test("REQ-054/069 selectPaymentsLinkName: a key missing in production (DENO_DEPLOYMENT_ID set) → throws loudly, naming every missing key", () => {
  assertThrows(() => selectPaymentsLinkName({ DENO_DEPLOYMENT_ID: "abc" }), Error, "PPWK_PAYMENTS_URL, PPWK_PAYMENTS_TOKEN, PPWK_PAYMENTS_ACCOUNT missing");
  assertThrows(() => selectPaymentsLinkName({ DENO_DEPLOYMENT_ID: "abc", PPWK_PAYMENTS_URL: "https://crm.test" }), Error, "PPWK_PAYMENTS_TOKEN, PPWK_PAYMENTS_ACCOUNT missing");
  assertThrows(() => selectPaymentsLinkName({ DENO_DEPLOYMENT_ID: "abc", PPWK_PAYMENTS_TOKEN: "t", PPWK_PAYMENTS_ACCOUNT: "primary" }), Error, "PPWK_PAYMENTS_URL missing");
  assertThrows(() => selectPaymentsLinkName({ DENO_DEPLOYMENT_ID: "abc", PPWK_PAYMENTS_URL: "https://crm.test", PPWK_PAYMENTS_TOKEN: "t" }), Error, "PPWK_PAYMENTS_ACCOUNT missing");
});
