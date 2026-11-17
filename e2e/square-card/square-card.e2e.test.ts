/**
 * REQ-803 — the business connects its OWN Square in Settings (the in-process fake, with a fake
 * token) and the customer pays the public invoice on Square's hosted checkout: "Pay $X by card"
 * (secure checkout by Square) → the fake Square checkout shows the amount and the business →
 * Pay → back on /i the invoice reads paid, and the office's invoice is paid by card with the
 * Square payment id as the reference. Cancel leaves it unpaid with the button still there.
 * Disconnecting brings the manual card chip back.
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
    body: JSON.stringify({ language: "en", name: "Square Story" }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Acme Roofing",
      // a manual method, and the manual "card" instructions — the chip Square replaces
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "pay@acme-roofing.test" },
        card: { enabled: true, instructions: "Call us with your card" },
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
  return { auth, cookie: { name, value } };
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

Deno.test("REQ-803: settings connects the business's own Square (the seller, the location, sandbox, the masked token); the customer pays on Square's checkout and the invoice reads paid with the Square payment id; cancel leaves it open; disconnect brings the manual card chip back", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, cookie } = await signIn(http, page, baseUrl);

    // 1. settings: connect Square with the fake token
    await page.goto("/settings");
    await page.locator("[data-cy='square-card']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='square-token']").fill("EAAAfake_acme");
    await page.locator("[data-cy='square-connect']").click();
    await page.locator("[data-cy='square-status']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Acme (fake Square seller)");
    await expect.see("Acme Main St (fake)");
    await expect.see("Sandbox");
    await expect.see("EAAA••••acme");
    expect.eq(
      (await page.locator("[data-cy='square-card']").textContent())?.includes(
        "EAAAfake_acme",
      ),
      false,
      "the token is never printed back",
    );
    expect.eq(
      await page.locator("[data-cy='square-merchant']").count(),
      1,
      "the merchant preview",
    );
    // stored, not just in the island
    await page.goto("/settings");
    await page.locator("[data-cy='square-status']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Acme (fake Square seller)");

    // 2. the customer's invoice: Pay $65.00 by card, through Square
    const inv = await mkInvoice(http, auth, 6500);
    await page.context().clearCookies();
    await page.goto(`/i/${inv.id}`);
    const pay = page.locator("[data-cy='pay-by-card']");
    await pay.waitFor({ timeout: 15_000 });
    await expect.see("Pay $65.00 by card");
    await expect.see("Secure checkout by Square");
    expect.eq(
      await page.locator("[data-cy='claim-method-card']").count(),
      0,
      "the manual card chip is gone while Square is on",
    );
    // tap (until the island has hydrated and answers) → the fake Square checkout
    const deadline = Date.now() + 30_000;
    while (!page.url().includes("/dev/square/checkout/")) {
      if (Date.now() > deadline) {
        throw new Error(`never reached Square's checkout (${page.url()})`);
      }
      await pay.click().catch(() => {});
      await page.waitForURL(/\/dev\/square\/checkout\//, { timeout: 3_000 })
        .catch(() => {});
    }
    await page.locator("[data-cy='fake-square-pay']").waitFor({
      timeout: 15_000,
    });
    await expect.see("$65.00");
    await expect.see("Acme Roofing");
    await page.locator("[data-cy='fake-square-pay']").click();
    await page.waitForURL(new RegExp(`/i/${inv.id}\\?square=return`), {
      timeout: 15_000,
    });
    await page.locator("[data-status-pill]").first().waitFor({
      timeout: 15_000,
    });
    expect.eq(
      (await page.locator("[data-status-pill]").first().textContent())?.trim()
        .toLowerCase(),
      "paid",
      "back on the invoice it reads paid, no manual reload",
    );
    expect.eq(
      await page.locator("[data-cy='pay-by-card']").count(),
      0,
      "nothing left to pay",
    );

    // 3. the office: paid by card, the reference is the Square payment id
    const office =
      await (await http(`/api/invoices/${inv.id}`, { headers: auth })).json();
    expect.eq(office.status, "paid", "the invoice is paid");
    const payments =
      (await (await http("/api/payments", { headers: auth })).json()) as Array<
        {
          invoiceId: string;
          method: string;
          reference?: string;
          amount: number;
        }
      >;
    const rows = payments.filter((p) => p.invoiceId === inv.id);
    expect.eq(rows.length, 1, "one payment row for the invoice");
    expect.eq(rows[0].method, "card", "paid by card");
    expect(
      String(rows[0].reference).startsWith("sqpay_fake_"),
      `the reference is the Square payment id (${rows[0].reference})`,
    );
    expect.eq(rows[0].amount, 6500, "the balance was paid");

    // 4. cancel on Square: back on the invoice, still open, the button still there
    const inv2 = await mkInvoice(http, auth, 12000);
    await page.goto(`/i/${inv2.id}`);
    const pay2 = page.locator("[data-cy='pay-by-card']");
    await pay2.waitFor({ timeout: 15_000 });
    await expect.see("Pay $120.00 by card");
    const deadline2 = Date.now() + 30_000;
    while (!page.url().includes("/dev/square/checkout/")) {
      if (Date.now() > deadline2) {
        throw new Error(`never reached Square's checkout (${page.url()})`);
      }
      await pay2.click().catch(() => {});
      await page.waitForURL(/\/dev\/square\/checkout\//, { timeout: 3_000 })
        .catch(() => {});
    }
    await page.locator("[data-cy='fake-square-cancel']").waitFor({
      timeout: 15_000,
    });
    await expect.see("$120.00");
    await page.locator("[data-cy='fake-square-cancel']").click();
    await page.waitForURL(new RegExp(`/i/${inv2.id}\\?square=return`), {
      timeout: 15_000,
    });
    await page.locator("[data-cy='pay-by-card']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='square-not-completed']").waitFor({
      timeout: 15_000,
    });
    const still =
      await (await http(`/api/invoices/${inv2.id}`, { headers: auth })).json();
    expect.eq(still.status, "sent", "the invoice is still open");
    const rows2 =
      ((await (await http("/api/payments", { headers: auth })).json()) as Array<
        { invoiceId: string }
      >).filter((p) => p.invoiceId === inv2.id);
    expect.eq(rows2.length, 0, "nothing recorded");

    // 5. disconnect: the next look at the invoice has no card button, the manual chip is back
    await page.context().addCookies([{ ...cookie, url: baseUrl }]);
    await page.goto("/settings");
    await page.locator("[data-cy='square-disconnect']").click();
    await page.locator("[data-cy='square-connect']").waitFor({
      timeout: 15_000,
    });
    await page.context().clearCookies();
    await page.goto(`/i/${inv2.id}`);
    await page.locator("[data-cy='claim-form']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='pay-by-card']").count(),
      0,
      "no card button without Square (and no card pay link)",
    );
    expect.eq(
      await page.locator("[data-cy='claim-method-card']").count(),
      1,
      "the manual card chip is back",
    );
  }));
