/**
 * REQ-057 — the fake link builder's pay page is a page of the app. Off the real CRM (no
 * PPWK_PAYMENTS_URL) the paid pick used to open https://payments.fake/…, a host that resolves
 * nowhere, so the demo died at the one step that matters. The fake now mints the app's own
 * /pay/fake page, carrying the customer and the due, at the app's url (APP_URL, the launcher's
 * frontend; the dev default otherwise).
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
import { fakePaymentsWorld, PaymentsLink } from "./mod.ts";

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

Deno.test("REQ-058 payments-link fake — a customer with a ref the fake knows is revised, never a second one; findCustomer reads it back", () =>
  withEnv({ PPWK_PAYMENTS_URL: undefined, PPWK_PAYMENTS_TOKEN: undefined, DENO_DEPLOYMENT_ID: undefined }, async () => {
    fakePaymentsWorld().reset();
    const link = new PaymentsLink();
    const first = await link.createCustomer({ customerName: "+15125550101", customerEmail: "", customerPhone: "+15125550101", externalRef: "pm:u-1" });
    const again = await link.createCustomer({ customerName: "Ana Roofing", customerEmail: "ana@roof.test", customerPhone: "+15125550101", externalRef: "pm:u-1" });
    assertEquals(again.customerId, first.customerId);
    assertEquals(fakePaymentsWorld().customers.length, 1);
    assertEquals(await link.findCustomer("pm:u-1"), { customerId: first.customerId, customerName: "Ana Roofing", customerEmail: "ana@roof.test", customerPhone: "+15125550101", externalRef: "pm:u-1" });
    assertEquals(await link.findCustomer("pm:nobody"), null);
  }));

Deno.test("REQ-059 payments-link fake — a link minted with a return address carries it to the stand-in page", () =>
  withEnv({ PPWK_PAYMENTS_URL: undefined, PPWK_PAYMENTS_TOKEN: undefined, DENO_DEPLOYMENT_ID: undefined, APP_URL: "http://localhost:13170" }, async () => {
    const { payUrl } = await new PaymentsLink().mintPayLink({ customerId: "c", dueId: "d", returnUrl: "http://localhost:13170/plan/return?due=d", returnLabel: "Paperwork Monster" });
    const u = new URL(payUrl);
    assertEquals(u.pathname, "/pay/fake");
    assertEquals(u.searchParams.get("return"), "http://localhost:13170/plan/return?due=d");
    assertEquals(u.searchParams.get("label"), "Paperwork Monster");
  }));

Deno.test("REQ-058 payments-link real — the customer goes to the CRM with its phone and ref; a ref the CRM does not know reads null", () =>
  withEnv({ PPWK_PAYMENTS_URL: "http://crm.test", PPWK_PAYMENTS_TOKEN: "t", DENO_DEPLOYMENT_ID: undefined }, async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const link = new PaymentsLink();
    link.fetchOverride = (input, init) => {
      const url = String(input);
      calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/by-external/pm%3Agone")) return Promise.resolve(new Response("{}", { status: 404 }));
      if (url.includes("/by-external/")) return Promise.resolve(Response.json({ customerId: "c-1", customerName: "Ana", customerEmail: "", customerPhone: "+15125550101", externalRef: "pm:u-1", ownerRef: "x" }));
      return Promise.resolve(Response.json({ customerId: "c-1" }));
    };
    assertEquals(await link.createCustomer({ customerName: "Ana", customerEmail: "", customerPhone: "+15125550101", externalRef: "pm:u-1" }), { customerId: "c-1" });
    assertEquals(calls[0], { method: "POST", url: "http://crm.test/api/payments/customers", body: { customerName: "Ana", customerEmail: "", customerPhone: "+15125550101", externalRef: "pm:u-1" } });
    assertEquals(await link.findCustomer("pm:u-1"), { customerId: "c-1", customerName: "Ana", customerEmail: "", customerPhone: "+15125550101", externalRef: "pm:u-1" });
    assertEquals(await link.findCustomer("pm:gone"), null);
    await link.mintPayLink({ customerId: "c-1", dueId: "d-1", returnUrl: "http://app.test/plan/return?due=d-1", returnLabel: "Paperwork Monster" });
    assertEquals(calls.at(-1)?.body, { customerId: "c-1", dueId: "d-1", brandId: "", returnUrl: "http://app.test/plan/return?due=d-1", returnLabel: "Paperwork Monster" });
  }));
