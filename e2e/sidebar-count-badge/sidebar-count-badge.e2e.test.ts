/**
 * REQ-518 (demo-loop cycle 3, demo issue p8-pair6-c) — "Unexplained red '1' badge on Customers in
 * the sidebar". The pink count pill (front-end/islands/DashSidebar.tsx, `.nav-item__count`) shows
 * only work that is waiting — sent quotes awaiting a reply, unpaid invoices — and says so in its
 * title / aria-label. The customers total is not a notification and gets no pill.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, {
    name: "Badge User",
    businessName: "Badge Business",
  });
  await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

Deno.test("REQ-518 (demo p8-pair6-c, cycle 3): one customer → no pill on Customers; an unpaid invoice → a labelled pill on Invoices", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const c = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Lone Customer",
        email: "lone@blackhole.postmarkapp.com",
      }),
    });
    const customer = await c.json();
    expect.eq(c.ok, true, "the customer was created");
    const inv = await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        amount: 50000,
        issuedDate: new Date().toISOString().slice(0, 10),
        status: "sent",
      }),
    });
    expect.eq(inv.ok, true, `the invoice was created (${inv.status})`);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    const billing = page.locator('[data-cy="nav-folder-billing"]');
    await billing.waitFor({ state: "visible" });
    // the counts arrive with /analytics/dashboard — open Billing and wait for the Invoices pill
    await billing.click();
    const invoicesPill = page.locator(
      'a.nav-item[href="/invoices"] .nav-item__count',
    );
    await invoicesPill.waitFor({ state: "visible" });
    expect.eq(
      (await invoicesPill.textContent())?.trim(),
      "1",
      "the Invoices pill counts the unpaid invoice",
    );
    // the counts are loaded now (the Invoices pill shows) — back to the root, where Customers is
    await page.locator('[data-cy="nav-back"]').click();
    const customersRow = page.locator('a.nav-item[href="/customers"]');
    await customersRow.waitFor({ state: "visible" });
    expect.eq(
      await customersRow.locator(".nav-item__count").count(),
      0,
      "the Customers row carries no count pill for one customer",
    );

    await billing.click();
    await invoicesPill.waitFor({ state: "visible" });
    expect.eq(
      await invoicesPill.getAttribute("aria-label"),
      "Invoices awaiting payment: 1",
      "the Invoices pill says what it counts",
    );
    expect.eq(
      await invoicesPill.getAttribute("title"),
      "Invoices awaiting payment: 1",
      "the Invoices pill has a hover title",
    );
  }));
