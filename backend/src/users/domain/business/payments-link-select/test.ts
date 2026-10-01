import { assertEquals, assertThrows } from "#std/assert";
import { selectPaymentsLinkName } from "./mod.ts";

// REQ-054 — production must never silently boot on the fake link builder (the REQ-001 rule).

Deno.test("REQ-054 selectPaymentsLinkName: both CRM keys set → crm, in or out of production", () => {
  assertEquals(selectPaymentsLinkName({ PPWK_PAYMENTS_URL: "https://crm.test", PPWK_PAYMENTS_TOKEN: "t" }), "crm");
  assertEquals(selectPaymentsLinkName({ PPWK_PAYMENTS_URL: "https://crm.test", PPWK_PAYMENTS_TOKEN: "t", DENO_DEPLOYMENT_ID: "abc" }), "crm");
});

Deno.test("REQ-054 selectPaymentsLinkName: a key missing outside production → fake (the gate's lanes and a dev box)", () => {
  assertEquals(selectPaymentsLinkName({}), "fake");
  assertEquals(selectPaymentsLinkName({ PPWK_PAYMENTS_URL: "https://crm.test" }), "fake");
  assertEquals(selectPaymentsLinkName({ PPWK_PAYMENTS_TOKEN: "t", PPWK_PAYMENTS_URL: "  " }), "fake");
});

Deno.test("REQ-054 selectPaymentsLinkName: a key missing in production (DENO_DEPLOYMENT_ID set) → throws loudly, naming the key", () => {
  assertThrows(() => selectPaymentsLinkName({ DENO_DEPLOYMENT_ID: "abc" }), Error, "both missing");
  assertThrows(() => selectPaymentsLinkName({ DENO_DEPLOYMENT_ID: "abc", PPWK_PAYMENTS_URL: "https://crm.test" }), Error, "PPWK_PAYMENTS_TOKEN missing");
  assertThrows(() => selectPaymentsLinkName({ DENO_DEPLOYMENT_ID: "abc", PPWK_PAYMENTS_TOKEN: "t" }), Error, "PPWK_PAYMENTS_URL missing");
});
