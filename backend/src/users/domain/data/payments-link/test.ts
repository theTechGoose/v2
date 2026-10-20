/**
 * REQ-057 — the fake link builder's pay page is a page of the app. Off the real CRM (no
 * PPWK_PAYMENTS_URL) the paid pick used to open https://payments.fake/…, a host that resolves
 * nowhere, so the demo died at the one step that matters. The fake now mints the app's own
 * /pay/fake page, carrying the customer and the due, at the app's url (APP_URL, the launcher's
 * frontend; the dev default otherwise).
 */
import { assertEquals, assertRejects, assertStringIncludes } from "#std/assert";
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
    const { payUrl } = await link.mintPayLink({ customerId: "cust-1", dueId: "due-1", merchant: "primary" });
    assertEquals(payUrl, "http://localhost:13170/pay/fake?customer=cust-1&due=due-1&account=primary");
  }));

Deno.test("REQ-057 payments-link fake — without APP_URL the page is at the dev default, never a dead host", () =>
  withEnv({ PPWK_PAYMENTS_URL: undefined, PPWK_PAYMENTS_TOKEN: undefined, DENO_DEPLOYMENT_ID: undefined, APP_URL: undefined }, async () => {
    const { payUrl } = await new PaymentsLink().mintPayLink({ customerId: "c", dueId: "d", merchant: "primary" });
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
    const { createdAt, ...ana } = (await link.findCustomer("pm:u-1"))!;
    assertEquals(ana, { customerId: first.customerId, customerName: "Ana Roofing", customerEmail: "ana@roof.test", customerPhone: "+15125550101", externalRef: "pm:u-1" });
    assertEquals(typeof createdAt, "string", "REQ-060: the record says when it was made");
    assertEquals(await link.findCustomer("pm:nobody"), null);
  }));

Deno.test("REQ-059 payments-link fake — a link minted with a return address carries it to the stand-in page", () =>
  withEnv({ PPWK_PAYMENTS_URL: undefined, PPWK_PAYMENTS_TOKEN: undefined, DENO_DEPLOYMENT_ID: undefined, APP_URL: "http://localhost:13170" }, async () => {
    const { payUrl } = await new PaymentsLink().mintPayLink({ customerId: "c", dueId: "d", returnUrl: "http://localhost:13170/plan/return?due=d", returnLabel: "DocuMonster", merchant: "primary" });
    const u = new URL(payUrl);
    assertEquals(u.pathname, "/pay/fake");
    assertEquals(u.searchParams.get("return"), "http://localhost:13170/plan/return?due=d");
    assertEquals(u.searchParams.get("label"), "DocuMonster");
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
    await link.mintPayLink({ customerId: "c-1", dueId: "d-1", returnUrl: "http://app.test/plan/return?due=d-1", returnLabel: "DocuMonster", merchant: "primary" });
    assertEquals(calls.at(-1)?.body, { customerId: "c-1", dueId: "d-1", brandId: "", returnUrl: "http://app.test/plan/return?due=d-1", returnLabel: "DocuMonster" });
  }));

Deno.test("REQ-060 payments-link fake — a phone alone is a lead; the ref that arrives with that phone claims it; a bare phone post changes nothing (the CRM's REQ-082)", () =>
  withEnv({ PPWK_PAYMENTS_URL: undefined, PPWK_PAYMENTS_TOKEN: undefined, DENO_DEPLOYMENT_ID: undefined }, async () => {
    fakePaymentsWorld().reset();
    const link = new PaymentsLink();
    const lead = await link.createCustomer({ customerName: "+15125550199", customerEmail: "", customerPhone: "+15125550199" });
    const again = await link.createCustomer({ customerName: "+15125550199", customerEmail: "", customerPhone: "+15125550199" });
    assertEquals(again.customerId, lead.customerId, "one lead for one phone");
    const claimed = await link.createCustomer({ customerName: "New user", customerEmail: "", customerPhone: "+15125550199", externalRef: "pm:u-9" });
    assertEquals(claimed.customerId, lead.customerId, "the sign-up is the lead");
    const read = await link.findCustomer("pm:u-9");
    assertEquals([read?.customerId, read?.customerName, typeof read?.createdAt], [lead.customerId, "New user", "string"]);
    const bare = await link.createCustomer({ customerName: "+15125550199", customerEmail: "", customerPhone: "+15125550199" });
    assertEquals(bare.customerId, lead.customerId);
    assertEquals((await link.findCustomer("pm:u-9"))?.customerName, "New user", "a bare phone post never overwrites");
    assertEquals(fakePaymentsWorld().customers.length, 1);
  }));

Deno.test("REQ-061 payments-link fake — the clock: a month on, the card on file is charged and the next bill moves; no card → past due with the month's page; paid there → current; canceled → never again", () =>
  withEnv({ PPWK_PAYMENTS_URL: undefined, PPWK_PAYMENTS_TOKEN: undefined, DENO_DEPLOYMENT_ID: undefined, APP_URL: "http://localhost:13170" }, async () => {
    const world = fakePaymentsWorld();
    world.reset();
    const link = new PaymentsLink();
    const { customerId } = await link.createCustomer({ customerName: "Rosa", customerEmail: "rosa@roof.test", externalRef: "pm:u-1" });
    const { dueId } = await link.raiseDue({ customerId, amountCents: 9900, memo: "Monster — first month" });
    world.settle(dueId); // the first month paid on the page: a card is on file now
    const { subscriptionId } = await link.startSubscription({ customerId, amountCents: 9900, memo: "Monster", externalRef: "pm:u-1:monster", firstBillAt: "2026-11-02T00:00:00.000Z", returnUrl: "http://localhost:13170/plan/return?back=%2Fsettings", returnLabel: "DocuMonster", merchant: "primary" });
    assertEquals((await link.findSubscription("pm:u-1:monster"))?.subscriptionId, subscriptionId);
    assertEquals((await link.subscription(subscriptionId))?.status, "active");
    world.bill("2026-11-01T00:00:00.000Z");
    assertEquals((await link.subscription(subscriptionId))?.nextBillAt, "2026-11-02T00:00:00.000Z", "not due yet");
    world.bill("2026-11-02T00:00:00.000Z");
    let sub = await link.subscription(subscriptionId);
    assertEquals([sub?.status, sub?.nextBillAt, sub?.cardLast4, sub?.lastBilledAt], ["active", "2026-12-02T00:00:00.000Z", "1111", "2026-11-02T00:00:00.000Z"]);
    world.dropCard(customerId);
    world.bill("2026-12-02T00:00:00.000Z");
    sub = await link.subscription(subscriptionId);
    assertEquals([sub?.status, sub?.failures, sub?.nextBillAt], ["past_due", 1, "2026-12-02T00:00:00.000Z"]);
    assertStringIncludes(sub!.payUrl, "http://localhost:13170/pay/fake?customer=");
    assertStringIncludes(sub!.payUrl, "return=http%3A%2F%2Flocalhost%3A13170%2Fplan%2Freturn");
    const monthDue = world.dues.find((d) => sub!.payUrl.includes(`due=${d.dueId}`))!;
    assertEquals([monthDue.memo, monthDue.open, monthDue.amountCents], ["Monster — December 2026", true, 9900]);
    world.settle(monthDue.dueId); // paid on the page
    sub = await link.subscription(subscriptionId);
    assertEquals([sub?.status, sub?.nextBillAt, sub?.payUrl, sub?.failures], ["active", "2027-01-02T00:00:00.000Z", "", 0]);
    await link.cancelSubscription(subscriptionId, "downgraded to free");
    world.bill("2027-02-01T00:00:00.000Z");
    assertEquals((await link.subscription(subscriptionId))?.status, "canceled");
    assertEquals(await link.subscription("nope"), null);
  }));

Deno.test("REQ-061 payments-link real — subscriptions go to the CRM's routes; its pay page path comes back absolute; 404 is null", () =>
  withEnv({ PPWK_PAYMENTS_URL: "http://crm.test", PPWK_PAYMENTS_TOKEN: "t", DENO_DEPLOYMENT_ID: undefined }, async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const link = new PaymentsLink();
    link.fetchOverride = (input, init) => {
      const url = String(input);
      calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/subscriptions/gone")) return Promise.resolve(new Response("{}", { status: 404 }));
      if (url.includes("/subscriptions/by-external/")) return Promise.resolve(Response.json({ subscriptionId: "s-1", status: "active", nextBillAt: "2026-11-02T00:00:00.000Z", lastBilledAt: "", cardBrand: "", cardLast4: "", failures: 0, payUrl: "", memo: "Monster" }));
      if (url.endsWith("/subscriptions/s-1")) return Promise.resolve(Response.json({ subscriptionId: "s-1", status: "past_due", nextBillAt: "2026-12-02T00:00:00.000Z", lastBilledAt: "2026-11-02T00:00:00.000Z", cardBrand: "visa", cardLast4: "1111", failures: 1, payUrl: "/ui/payments/charge?customer=x&due=d-dec" }));
      return Promise.resolve(Response.json({ subscriptionId: "s-1" }));
    };
    assertEquals(await link.startSubscription({ customerId: "c-1", amountCents: 9900, memo: "Monster", externalRef: "pm:u-1:monster", firstBillAt: "2026-11-02T00:00:00.000Z", returnUrl: "http://app.test/plan/return?back=%2Fsettings", returnLabel: "DocuMonster", merchant: "primary" }), { subscriptionId: "s-1" });
    assertEquals(calls[0], { method: "POST", url: "http://crm.test/api/payments/subscriptions", body: { customerId: "c-1", amountCents: 9900, categoryCode: "sales", memo: "Monster", externalRef: "pm:u-1:monster", firstBillAt: "2026-11-02T00:00:00.000Z", brandId: "", returnUrl: "http://app.test/plan/return?back=%2Fsettings", returnLabel: "DocuMonster" } });
    assertEquals((await link.findSubscription("pm:u-1:monster"))?.status, "active");
    assertEquals(calls.at(-1)?.url, "http://crm.test/api/payments/subscriptions/by-external/pm%3Au-1%3Amonster");
    const sub = await link.subscription("s-1");
    assertEquals([sub?.status, sub?.payUrl, sub?.cardLast4, sub?.failures], ["past_due", "http://crm.test/ui/payments/charge?customer=x&due=d-dec", "1111", 1]);
    assertEquals(await link.subscription("gone"), null);
    await link.cancelSubscription("s-1", "downgraded to free");
    assertEquals(calls.at(-1), { method: "POST", url: "http://crm.test/api/payments/subscriptions/s-1/cancel", body: { subscriptionId: "s-1", reason: "downgraded to free" } });
  }));

// REQ-062 — the tier travels with the customer: sent on every write, read back with the record
Deno.test("REQ-062 payments-link real — a customer goes to the CRM with its tier and comes back with it", () =>
  withEnv({ PPWK_PAYMENTS_URL: "http://crm.test", PPWK_PAYMENTS_TOKEN: "t", DENO_DEPLOYMENT_ID: undefined }, async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const link = new PaymentsLink();
    link.fetchOverride = (input, init) => {
      const url = String(input);
      calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/customers/by-external/")) {
        return Promise.resolve(Response.json({ customerId: "c-1", customerName: "unknown dragon mcdragonson", customerEmail: "", customerPhone: "+15125550100", externalRef: "pm:u-1", tier: "Monster", createdAt: "2026-10-02T00:00:00.000Z" }));
      }
      return Promise.resolve(Response.json({ customerId: "c-1" }));
    };
    await link.createCustomer({ customerName: "unknown dragon mcdragonson", customerEmail: "", customerPhone: "+15125550100", tier: "Lead" });
    assertEquals(calls[0].method, "POST");
    assertStringIncludes(calls[0].url, "/api/payments/customers");
    assertEquals((calls[0].body as { tier: string }).tier, "Lead");
    const found = await link.findCustomer("pm:u-1");
    assertEquals(found?.tier, "Monster");
    assertEquals(found?.customerName, "unknown dragon mcdragonson");
  }));

// REQ-064/100 — the merchant account a pick names rides on the link the fake mints and on the
// billing, the way the CRM's does: `account=` on the page's url (ppwk-crm REQ-091), so the page
// prints the one name the charge goes through
Deno.test("REQ-064/100 payments-link fake — the link's url carries `account=<the pick's account>` and the billing carries it; a mint or a billing that names none is refused by name, nothing minted", () =>
  withEnv({ PPWK_PAYMENTS_URL: undefined, PPWK_PAYMENTS_TOKEN: undefined, DENO_DEPLOYMENT_ID: undefined, APP_URL: "http://localhost:13170" }, async () => {
    const link = new PaymentsLink();
    const world = fakePaymentsWorld();
    world.reset();
    const { customerId } = await link.createCustomer({ customerName: "Merchant Test", customerEmail: "m@roof.test", externalRef: "pm:u-64", tier: "Lead" });
    const { dueId } = await link.raiseDue({ customerId, amountCents: 100, memo: "Monster Test — one-time test charge" });
    const named = await link.mintPayLink({ customerId, dueId, merchant: "sandbox" });
    assertEquals(new URL(named.payUrl).searchParams.get("account"), "sandbox", "the account on the page's url, as the CRM's link carries it");
    assertEquals(new URL(named.payUrl).searchParams.has("merchant"), false, "one word for it: account");
    assertEquals(world.links[0].merchant, "sandbox");
    const e = await assertRejects(() => link.mintPayLink({ customerId, dueId, merchant: "" }), Error, "merchant-required");
    assertEquals((e as Error & { status?: number }).status, 400);
    assertEquals(world.links.length, 1, "nothing minted without an account");
    const { subscriptionId } = await link.startSubscription({ customerId, amountCents: 9900, memo: "Monster", externalRef: "pm:u-64:monster", firstBillAt: "2026-11-03T00:00:00.000Z", merchant: "primary" });
    assertEquals(world.subscriptions.find((s) => s.subscriptionId === subscriptionId)?.merchant, "primary");
    await assertRejects(() => link.startSubscription({ customerId, amountCents: 9900, memo: "Monster", externalRef: "pm:u-64:monster", firstBillAt: "2026-11-03T00:00:00.000Z", merchant: "" }), Error, "merchant-required");
    assertEquals(world.subscriptions.length, 1, "no billing started without an account");
  }));

// REQ-101 — "PRIMARY IS THE ACUTAL ACCOUNT AND SANDBOX IS THE FAKE ACCOUNT BUT WE CAN ADD MORE": the
// fake keeps the CRM's accounts on record (its Accounts tab, ppwk-crm REQ-091) and refuses a name
// that is not there the way the CRM does — merchant-unknown, 422, before any write
Deno.test("REQ-101 payments-link fake — primary and sandbox are on record; a name that is not is merchant-unknown (422) and nothing is minted; an account added to the record is admitted", () =>
  withEnv({ PPWK_PAYMENTS_URL: undefined, PPWK_PAYMENTS_TOKEN: undefined, DENO_DEPLOYMENT_ID: undefined, APP_URL: "http://localhost:13170" }, async () => {
    const link = new PaymentsLink();
    const world = fakePaymentsWorld();
    world.reset();
    assertEquals([...world.accounts].sort(), ["primary", "sandbox"], "the two accounts the CRM has on record, after a reset");
    const { customerId } = await link.createCustomer({ customerName: "Accounts Test", customerEmail: "a@roof.test", externalRef: "pm:u-101", tier: "Lead" });
    const { dueId } = await link.raiseDue({ customerId, amountCents: 9900, memo: "Monster — first month" });
    for (const account of ["primary", "sandbox"]) {
      const { payUrl } = await link.mintPayLink({ customerId, dueId, merchant: account });
      assertEquals(new URL(payUrl).searchParams.get("account"), account);
    }
    const e = await assertRejects(() => link.mintPayLink({ customerId, dueId, merchant: "alpha" }), Error, "merchant-unknown: alpha");
    assertEquals((e as Error & { status?: number }).status, 422);
    assertEquals(world.links.length, 2, "nothing minted for a name not on record");
    await assertRejects(() => link.startSubscription({ customerId, amountCents: 9900, memo: "Monster", externalRef: "pm:u-101:monster", firstBillAt: "2026-11-03T00:00:00.000Z", merchant: "alpha" }), Error, "merchant-unknown: alpha");
    assertEquals(world.subscriptions.length, 0);
    world.accounts.add("alpha"); // the operator put it on record
    const { payUrl } = await link.mintPayLink({ customerId, dueId, merchant: "alpha" });
    assertEquals(new URL(payUrl).searchParams.get("account"), "alpha", "more can be added");
  }));

// REQ-100 — "THERE NEEDS TO BE A SINGLE SOURCE OF TRUTH WHEN IT REGARDS TO WHAT ACCOUNT IS BEING
// USED": the account on a charge is the pick's, named on every call — never an env var's. The
// `PPWK_PAYMENTS_ACCOUNT` default (REQ-069) is gone: it is what sent a real $99 through sandbox.
Deno.test("REQ-100 payments-link real — every mint and every subscription carries the pick's account in `x-account`; nothing named is refused by name, never defaulted; the CRM's 422 reads merchant-unknown", () =>
  withEnv({ PPWK_PAYMENTS_URL: "http://crm.test", PPWK_PAYMENTS_TOKEN: "t", PPWK_PAYMENTS_ACCOUNT: "sandbox", DENO_DEPLOYMENT_ID: undefined }, async () => {
    const calls: Array<{ method: string; url: string; body: Record<string, unknown>; account: string | null }> = [];
    const link = new PaymentsLink();
    link.fetchOverride = (input, init) => {
      const url = String(input);
      const account = new Headers(init?.headers).get("x-account");
      calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : {}, account });
      if (account === "alpha") return Promise.resolve(new Response(JSON.stringify({ error: "merchant-unknown", message: "merchant-unknown: alpha" }), { status: 422 }));
      if (url.endsWith("/api/payments/pay-links")) return Promise.resolve(Response.json({ chargeUrl: `/ui/payments/charge?customer=x&due=d-1&account=${account}` }));
      return Promise.resolve(Response.json({ subscriptionId: "s-1" }));
    };
    const minted = await link.mintPayLink({ customerId: "c-1", dueId: "d-1", merchant: "primary" });
    assertEquals(calls[0].account, "primary", "the pick's account rides the header");
    assertEquals("merchant" in calls[0].body, false, "and never the body");
    assertEquals(minted.payUrl, "http://crm.test/ui/payments/charge?customer=x&due=d-1&account=primary", "the page's url names the same account");
    await link.startSubscription({ customerId: "c-1", amountCents: 9900, memo: "Monster", externalRef: "pm:u:monster", firstBillAt: "2026-11-03T00:00:00.000Z", merchant: "primary" });
    assertEquals(calls[1].account, "primary");
    assertEquals("merchant" in calls[1].body, false);
    // nothing named: refused here, before any request — the env var set above is never read
    const e = await assertRejects(() => link.mintPayLink({ customerId: "c-1", dueId: "d-1", merchant: "" }), Error, "merchant-required");
    assertEquals((e as Error & { status?: number }).status, 400);
    await assertRejects(() => link.startSubscription({ customerId: "c-1", amountCents: 9900, memo: "Monster", externalRef: "pm:u:monster", firstBillAt: "2026-11-03T00:00:00.000Z", merchant: "" }), Error, "merchant-required");
    assertEquals(calls.length, 2, "no request went out without an account");
    // a name the CRM does not have on record: its 422 is merchant-unknown here, not payments-unavailable
    const unknown = await assertRejects(() => link.mintPayLink({ customerId: "c-1", dueId: "d-1", merchant: "alpha" }), Error, "merchant-unknown: alpha");
    assertEquals((unknown as Error & { status?: number }).status, 422);
    const customer = await link.createCustomer({ customerName: "Ana", customerEmail: "a@b.c" }).catch(() => null);
    assertEquals(calls.at(-1)?.account, null, "a call that does not charge carries no account");
    void customer;
  }));
