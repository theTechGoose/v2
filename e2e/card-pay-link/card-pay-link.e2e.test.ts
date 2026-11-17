/**
 * REQ-782 (demo-loop dv1, issue d10) — Raphael: "Card payments should be a link to a separate
 * portal." The owner turns Card on in Settings → Payments and pastes the business's card payment
 * link (http:// is refused, https is saved). Before that, the owner's own view of the invoice says
 * how to set card up and the customer sees no card button; after it, the customer's /i/:id shows
 * "Pay $65.00 by card" first, which opens the business's own portal in a new tab — in English and
 * in Spanish.
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Card Link Story" }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Acme Roofing",
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "pay@acme-roofing.test" },
      },
    }),
  })).body?.cancel();
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

async function mkInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  amount: number,
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Ana Torres",
      email: "ana@blackhole.postmarkapp.com",
    }),
  })).json();
  return await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      status: "sent",
      jobName: "Roof repair",
      amount,
      issuedDate: "2026-11-01",
      dueDate: "2026-11-30",
    }),
  })).json();
}

const PORTAL = "https://buy.stripe.com/test_acme_roofing";

Deno.test("REQ-782: Settings takes the card payment link; /i/:id shows 'Pay by card', which opens the business's own portal in a new tab; without it the owner is told how to set it up", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await mkInvoice(http, auth, 6500);

    // 1. no card way yet: the owner's own view says how to set it up …
    await page.goto(`/i/${inv.id}`);
    await page.locator("[data-cy='pay-by-card-setup']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='pay-by-card-setup-link']").getAttribute(
        "href",
      ),
      "/settings#card-payments",
      "the hint links to Settings → Card payments (REQ-808)",
    );
    // … and the customer sees no card button (no dead end)
    const cookies = await page.context().cookies();
    await page.context().clearCookies();
    await page.goto(`/i/${inv.id}`);
    await page.locator("[data-cy='claim-form']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='pay-by-card']").count(),
      0,
      "no Pay by card without a portal",
    );
    expect.eq(
      await page.locator("[data-cy='pay-by-card-setup']").count(),
      0,
      "the setup hint is the owner's alone",
    );
    await page.context().addCookies(cookies);

    // 2. Settings → Card payments → Custom button (REQ-808: the link moved to its own tab;
    // the hint's deep link lands on the section) — http:// is refused, https is saved
    await page.goto("/settings#card-link");
    const urlInput = page.locator("[data-cy='pay-card-url']");
    await urlInput.waitFor({ timeout: 15_000 });
    await expect.see("Customers tap “Pay by card” on your invoice");
    await urlInput.fill("http://buy.stripe.com/test_acme_roofing");
    await expect.see("The card payment link must be a full https:// address");
    await urlInput.fill(PORTAL);
    await urlInput.blur();
    let stored = "";
    for (let i = 0; i < 40 && stored !== PORTAL; i++) {
      const id = await (await http("/api/profile/identity", { headers: auth }))
        .json();
      stored = id?.acceptedPaymentMethods?.card?.url ?? "";
      if (stored !== PORTAL) await page.waitForTimeout(250);
    }
    expect.eq(stored, PORTAL, "the card link is saved");
    // it survives a reload (the custom tab, now set, is the one that opens)
    await page.goto("/settings");
    await page.locator("[data-cy='pay-card-url']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='pay-card-url']").inputValue(),
      PORTAL,
      "the link reads back",
    );

    // 3. the customer: Pay by card first, opening the business's portal in a new tab
    await page.context().clearCookies();
    await page.context().route(
      "https://buy.stripe.com/**",
      (r) =>
        r.fulfill({
          contentType: "text/html",
          body:
            "<title>Acme Roofing — pay</title><h1>Acme Roofing card portal</h1>",
        }),
    );
    await page.goto(`/i/${inv.id}`);
    const btn = page.locator("[data-cy='pay-by-card']");
    await btn.waitFor({ timeout: 15_000 });
    expect.eq(await btn.getAttribute("href"), PORTAL, "the business's portal");
    expect.eq(await btn.getAttribute("target"), "_blank", "a new tab");
    expect.eq(
      await btn.getAttribute("rel"),
      "noopener noreferrer",
      "never hands the page to the portal",
    );
    await expect.see("Pay $65.00 by card");
    await expect.see("Enter $65.00 and invoice");
    const order = await page.evaluate(() => {
      const all = [...document.querySelectorAll("[data-cy]")].map((e) =>
        e.getAttribute("data-cy")
      );
      return {
        card: all.indexOf("pay-by-card"),
        claim: all.indexOf("claim-form"),
      };
    });
    expect(
      order.card >= 0 && (order.claim < 0 || order.card < order.claim),
      "Pay by card comes before 'I sent it'",
    );
    const [portal] = await Promise.all([
      page.context().waitForEvent("page"),
      btn.click(),
    ]);
    await portal.waitForLoadState();
    expect.eq(portal.url(), PORTAL, "the portal opened in its own tab");
    expect(
      (await portal.textContent("h1"))?.includes("Acme Roofing"),
      "the business's portal",
    );
    await portal.close();

    // 4. in Spanish
    await page.goto(`/i/${inv.id}?lang=es`);
    await page.locator("[data-cy='pay-by-card']").waitFor({ timeout: 15_000 });
    await expect.see("Pagar $65.00 con tarjeta");
  }));
