import { assertEquals, assertThrows } from "#std/assert";
import { selectPaymentsLinkName } from "./mod.ts";

// REQ-054 — production must never silently boot on the fake link builder (the REQ-001 rule).
// REQ-100 — two keys select the real client: the CRM's url and the bearer. The merchant account
// is NOT a key any more: `PPWK_PAYMENTS_ACCOUNT` (REQ-069) was the env knob that sent a real
// customer's $99 through the sandbox account; every pick names its account itself now
// (shared/quote-flow/merchant-accounts.ts), and an env var cannot override that.

const BOTH = { PPWK_PAYMENTS_URL: "https://crm.test", PPWK_PAYMENTS_TOKEN: "t" };

Deno.test("REQ-054/100 selectPaymentsLinkName: the CRM's url and token set → crm, in or out of production", () => {
  assertEquals(selectPaymentsLinkName(BOTH), "crm");
  assertEquals(selectPaymentsLinkName({ ...BOTH, DENO_DEPLOYMENT_ID: "abc" }), "crm");
});

Deno.test("REQ-100 selectPaymentsLinkName: PPWK_PAYMENTS_ACCOUNT is not read — set or not, it changes nothing", () => {
  assertEquals(selectPaymentsLinkName({ ...BOTH, PPWK_PAYMENTS_ACCOUNT: "sandbox" } as Record<string, string>), "crm");
  assertEquals(selectPaymentsLinkName({ PPWK_PAYMENTS_ACCOUNT: "primary" } as Record<string, string>), "fake");
});

Deno.test("REQ-054/100 selectPaymentsLinkName: a key missing outside production → fake (the gate's lanes and a dev box)", () => {
  assertEquals(selectPaymentsLinkName({}), "fake");
  assertEquals(selectPaymentsLinkName({ PPWK_PAYMENTS_URL: "https://crm.test" }), "fake");
  assertEquals(selectPaymentsLinkName({ PPWK_PAYMENTS_TOKEN: "t", PPWK_PAYMENTS_URL: "  " }), "fake");
});

Deno.test("REQ-054/100 selectPaymentsLinkName: a key missing in production (DENO_DEPLOYMENT_ID set) → throws loudly, naming every missing key", () => {
  assertThrows(() => selectPaymentsLinkName({ DENO_DEPLOYMENT_ID: "abc" }), Error, "PPWK_PAYMENTS_URL, PPWK_PAYMENTS_TOKEN missing");
  assertThrows(() => selectPaymentsLinkName({ DENO_DEPLOYMENT_ID: "abc", PPWK_PAYMENTS_URL: "https://crm.test" }), Error, "PPWK_PAYMENTS_TOKEN missing");
  assertThrows(() => selectPaymentsLinkName({ DENO_DEPLOYMENT_ID: "abc", PPWK_PAYMENTS_TOKEN: "t" }), Error, "PPWK_PAYMENTS_URL missing");
});
