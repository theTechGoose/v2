/**
 * REQ-555 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4 (run r857a9d67), issue M24: on /payments "View
 * receipt →" and the back's Receipt / Match invoice / Text client did
 * nothing (stopPropagation-only placeholders); on /invoices "Open" lived
 * only on the back face and the card's send-failure note sat outside the
 * card body, over that hit area.
 *
 * Pages: /payments (front-end/islands/PaymentsPage.tsx PaymentCard) and
 * /invoices (front-end/islands/InvoicesPage.tsx InvoiceCard).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Card Actions Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function makeInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customer: Record<string, string>,
  status: "draft" | "sent",
) {
  const today = new Date().toISOString().slice(0, 10);
  return await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: (await (await http("/api/customers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify(customer),
      })).json()).id,
      jobName: "Fence repair",
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "job",
        price: 31000,
      }],
      amount: 31000,
      status,
      issuedDate: today,
      dueDate: today,
    }),
  })).json() as { id: string };
}

/** an island may still be hydrating when its control appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-555 M24: a /payments card's View receipt, Receipt, Match invoice and Text client each go somewhere", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await makeInvoice(http, auth, {
      name: "Rosa Diaz",
      phoneNumber: "+15125550555",
    }, "sent");
    const paid = await http("/api/payments", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        invoiceId: inv.id,
        amount: 31000,
        method: "cash",
        receivedAt: new Date().toISOString(),
      }),
    });
    expect(paid.ok, `the payment is recorded (${paid.status})`);
    await paid.body?.cancel();

    await page.goto("/payments");
    const card = page.locator("[data-cy='payment-card']").first();
    await card.waitFor({ timeout: 15_000 });

    // Front: "View receipt →" opens the paid invoice's page in a new tab.
    const cta = card.locator("[data-cy='pay-card-cta']");
    expect.eq(await cta.getAttribute("href"), `/i/${inv.id}`, "CTA → receipt");
    const [receiptTab] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 10_000 }),
      cta.click(),
    ]);
    await receiptTab.waitForLoadState();
    expect(
      new URL(receiptTab.url()).pathname === `/i/${inv.id}`,
      `the receipt tab is the invoice page (${receiptTab.url()})`,
    );
    await receiptTab.close();

    // Back: flip the card, then Receipt / Match invoice / Text client.
    await clickUntil(
      page,
      "[data-cy='payment-card'] .qcard__story",
      async () =>
        (await card.getAttribute("class"))?.includes("qcard--flipped") ??
          false,
    );
    expect.eq(
      await card.locator("[data-cy='pay-card-receipt']").getAttribute(
        "href",
      ),
      `/i/${inv.id}`,
      "Receipt → the paid invoice's page",
    );
    expect.eq(
      await card.locator("[data-cy='pay-card-match']").getAttribute(
        "href",
      ),
      `/invoices?open=${inv.id}`,
      "Match invoice → the invoice's detail",
    );

    // REQ-555 AMENDMENT — reconciled with develop on demo-fixes (REQ-626):
    // Text client opens the client's sheet, where Message texts them.
    const textHref = await card.locator("[data-cy='pay-card-text']")
      .getAttribute("href");
    expect(
      !!textHref && textHref.startsWith("/clients?open="),
      `Text client opens the client's sheet (${textHref})`,
    );

    // Match invoice lands on that invoice's detail.
    await card.locator("[data-cy='pay-card-match']").click();
    await page.waitForURL(`**/invoices?open=${inv.id}`, { timeout: 15_000 });
  }));

Deno.test("REQ-555 M24: an /invoices card's front face has its own Open link, and a send failure renders inside the card body (never over the back face)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    // REQ-727 (cycle 5, c4-M16): the send sheet asks for a missing contact
    // before it sends — so a fictional 555 phone: the text it sends fails
    // honestly (it never reaches Twilio).
    const inv = await makeInvoice(
      http,
      auth,
      { name: "Tomas Vega", phoneNumber: "+15125550147" },
      "draft",
    );

    await page.goto("/invoices");
    const card = page.locator("article.qcard--inv").filter({
      has: page.locator("[data-cy='invoice-cta-drafting']"),
    }).first();
    await card.waitFor({ timeout: 15_000 });

    const open = card.locator("[data-cy='invoice-card-open']");
    // REQ-586 links carry the invoice's language (?lang=en): the page it
    // opens is what counts (REQ-727: this stale exact match stopped the story
    // before its send).
    expect.eq(
      (await open.getAttribute("href"))?.split("?")[0],
      `/i/${inv.id}`,
      "front Open",
    );

    const fail = card.locator("[data-cy='invoice-send-failure']");
    // REQ-727: "Finish + send" opens the send sheet — Text, then its Send.
    await clickUntil(
      page,
      "[data-cy='invoice-cta-drafting']",
      () => page.locator("[data-cy='send-dialog']").isVisible(),
    );
    await page.locator("[data-cy='send-option-sms']").click();
    await page.locator("[data-cy='send-keep']").click();
    await fail.waitFor({ timeout: 15_000 });
    expect(
      await fail.evaluate((el) => el.closest(".qcard__body") !== null),
      "the send failure is inside .qcard__body",
    );

    // Open still clicks with the failure showing — nothing covers it.
    const [tab] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 10_000 }),
      open.click({ timeout: 5_000 }),
    ]);
    await tab.waitForLoadState();
    expect(
      new URL(tab.url()).pathname === `/i/${inv.id}`,
      `Open goes to the invoice page (${tab.url()})`,
    );
    await tab.close();
  }));
