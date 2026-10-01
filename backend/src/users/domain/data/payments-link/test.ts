/**
 * REQ-057 — the fake link builder's pay page is a page of the app. Off the real CRM (no
 * PPWK_PAYMENTS_URL) the paid pick used to open https://payments.fake/…, a host that resolves
 * nowhere, so the demo died at the one step that matters. The fake now mints the app's own
 * /pay/fake page, carrying the customer and the due, at the app's url (APP_URL, the launcher's
 * frontend; the dev default otherwise).
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { PaymentsLink } from "./mod.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  return fn().finally(() => {
    for (const [k, v] of Object.entries(before)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  });
}

Deno.test("REQ-057 payments-link fake — the pay link is the app's own /pay/fake page carrying customer and due", () =>
  withEnv({ PPWK_PAYMENTS_URL: undefined, PPWK_PAYMENTS_TOKEN: undefined, DENO_DEPLOYMENT_ID: undefined, APP_URL: "http://localhost:13170" }, async () => {
    const link = new PaymentsLink();
    assertEquals(link.isFake(), true);
    const { payUrl } = await link.mintPayLink({ customerId: "cust-1", dueId: "due-1" });
    assertEquals(payUrl, "http://localhost:13170/pay/fake?customer=cust-1&due=due-1");
  }));

Deno.test("REQ-057 payments-link fake — without APP_URL the page is at the dev default, never a dead host", () =>
  withEnv({ PPWK_PAYMENTS_URL: undefined, PPWK_PAYMENTS_TOKEN: undefined, DENO_DEPLOYMENT_ID: undefined, APP_URL: undefined }, async () => {
    const { payUrl } = await new PaymentsLink().mintPayLink({ customerId: "c", dueId: "d" });
    assertStringIncludes(payUrl, "http://localhost:5280/pay/fake?customer=c&due=d");
    assertEquals(payUrl.includes("payments.fake"), false);
  }));
