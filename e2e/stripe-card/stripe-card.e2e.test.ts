/**
 * REQ-212 / REQ-213 / REQ-216 — the business connects its own Stripe in settings (the fake, with fake
 * keys), and the customer pays the public invoice on the flip card: the card flips on the CVV,
 * 4242… pays and the page reads PAID without a reload, the office's invoice is paid with a card
 * payment whose reference is the Stripe intent; 4000 0000 0000 0002 declines and keeps the form;
 * disconnecting takes the card off the next invoice.
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
    body: JSON.stringify({ language: "en", name: "Stripe Story" }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Acme Roofing",
      // a manual method, and the manual "card" instructions — the chip Stripe replaces
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

Deno.test("REQ-212: settings connects the business's own Stripe — the account, the mode, the masked secret, the merchant line; REQ-213 / REQ-216: the customer pays on the CRM's flip card (cells, ring, mask, brand) and the office sees the card payment", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);

    // 1. settings: the card is there, not connected
    await page.goto("/settings");
    await page.locator("[data-cy='stripe-card']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='stripe-pk']").fill("pk_test_fake_acme");
    await page.locator("[data-cy='stripe-sk']").fill("sk_test_fake_acme");
    await page.locator("[data-cy='stripe-connect']").click();
    await page.locator("[data-cy='stripe-status']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Acme (fake Stripe account)");
    await expect.see("Test mode");
    await expect.see("sk_test_••••acme");
    expect.eq(
      (await page.locator("[data-cy='stripe-card']").textContent())?.includes(
        "sk_test_fake_acme",
      ),
      false,
      "the secret is never printed back",
    );
    await expect.see("Acme Roofing");
    expect.eq(
      await page.locator("[data-cy='stripe-merchant']").count(),
      1,
      "the merchant preview",
    );
    // the status survives a reload (it is stored, not just in the island)
    await page.goto("/settings");
    await page.locator("[data-cy='stripe-status']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Acme (fake Stripe account)");

    // 2. the public invoice offers the card, branded with the business
    const inv = await mkInvoice(http, auth, 6500);
    await page.context().clearCookies();
    await page.goto(`/i/${inv.id}`);
    // REQ-782: "Pay by card" is a link to a separate portal — our card page on their Stripe
    const payByCard = page.locator("[data-cy='pay-by-card']");
    await payByCard.waitFor({ timeout: 15_000 });
    expect.eq(
      await payByCard.getAttribute("href"),
      `/i/${inv.id}/pay`,
      "Pay by card opens the card portal",
    );
    expect.eq(await payByCard.getAttribute("target"), "_blank", "a new tab");
    await expect.see("Pay $65.00 by card");
    expect.eq(
      await page.locator("[data-cy='card-pay']").count(),
      0,
      "no card form on the invoice itself",
    );
    expect.eq(
      await page.locator("[data-cy='claim-method-card']").count(),
      0,
      "the manual card chip is gone while Stripe is on",
    );
    await page.goto(`/i/${inv.id}/pay`);
    await page.locator("[data-cy='card-pay']").waitFor({ timeout: 15_000 });
    await expect.see("Acme Roofing");
    const front = page.locator(".pc-card");
    expect.eq(
      (await front.getAttribute("class"))?.includes("pc-card--active"),
      false,
      "the card shows its front",
    );
    // REQ-216 — the CRM's card, whole: the malachite art, one digit per cell, the ring on the
    // number while it has focus, the Visa mark fading up
    expect(
      String(
        await page.locator(".pc-card__side--front .pc-card__bg").getAttribute(
          "src",
        ),
      ).includes("malachite"),
      "the card's face is the clean malachite art",
    );
    await page.locator("[data-cy='card-number']").fill("4242424242424242");
    expect.eq(
      await page.locator("[data-cy='card-number']").inputValue(),
      "4242 4242 4242 4242",
      "the number groups in fours",
    );
    await expect.see("4242 4242 4242 4242");
    expect.eq(
      await page.locator(".pc-card__numberItem").count(),
      19,
      "one cell per digit and per space",
    );
    await page.waitForFunction(
      () => document.querySelector(".pc-card__focus--active") !== null,
      undefined,
      { timeout: 5_000 },
    );
    // the Visa mark is on the card (it fades up on the render after the brand is known)
    await page.locator(
      ".pc-card__side--front .pc-card__typeImg[src*='visa.png']",
    ).waitFor({ timeout: 5_000 });
    await page.locator("[data-cy='card-holder']").fill("Ana Torres");
    // focus left the number: it masks; the ring moved to the name; the holder prints in cells
    await expect.see("4242 **** **** 4242");
    expect.eq(
      await page.locator(".pc-card__nameItem span:not(:empty)").count(),
      10,
      "the holder prints one character per cell",
    );
    await expect.see("ANA TORRES");
    await page.locator("[data-cy='card-expiry']").fill("1234");
    expect.eq(
      await page.locator("[data-cy='card-expiry']").inputValue(),
      "12/34",
      "the expiry is MM/YY",
    );
    await page.locator("[data-cy='card-cvc']").focus();
    await page.waitForFunction(
      () =>
        document.querySelector(".pc-card")?.classList.contains(
          "pc-card--active",
        ),
      undefined,
      { timeout: 5_000 },
    );
    await page.locator("[data-cy='card-cvc']").fill("123");
    await page.locator("[data-cy='card-holder']").focus();
    await page.waitForFunction(
      () =>
        !document.querySelector(".pc-card")?.classList.contains(
          "pc-card--active",
        ),
      undefined,
      { timeout: 5_000 },
    );
    await expect.see("Pay $65.00");
    await page.locator("[data-cy='card-pay-submit']").click();
    await page.locator("[data-cy='card-paid']").waitFor({ timeout: 15_000 });
    expect.eq(
      (await page.locator("[data-status-pill]").textContent())?.trim()
        .toLowerCase(),
      "paid",
      "the page's badge reads paid without a reload",
    );
    expect.eq(
      await page.locator("[data-cy='claim-form']").isVisible(),
      false,
      "the manual methods are put away",
    );

    // 3. the office: the invoice is paid by card, the reference is the Stripe intent
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
    const row = payments.find((p) => p.invoiceId === inv.id);
    expect(!!row, "one payment row for the invoice");
    expect.eq(row!.method, "card", "paid by card");
    expect(
      String(row!.reference).startsWith("pi_fake_"),
      `the reference is the Stripe intent (${row!.reference})`,
    );
    expect.eq(row!.amount, 6500, "the balance was charged");

    // 4. a declined card says so and keeps the form
    const inv2 = await mkInvoice(http, auth, 12000);
    await page.goto(`/i/${inv2.id}/pay`);
    await page.locator("[data-cy='card-pay']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='card-number']").fill("4000000000000002");
    await page.locator("[data-cy='card-holder']").fill("Ana Torres");
    await page.locator("[data-cy='card-expiry']").fill("1234");
    await page.locator("[data-cy='card-cvc']").fill("123");
    await page.locator("[data-cy='card-pay-submit']").click();
    await page.locator("[data-cy='card-error']").waitFor({ timeout: 15_000 });
    await expect.see("Your card was declined.");
    expect.eq(
      await page.locator("[data-cy='card-pay-submit']").count(),
      1,
      "the form stays",
    );
    const still =
      await (await http(`/api/invoices/${inv2.id}`, { headers: auth })).json();
    expect.eq(still.status, "sent", "the invoice is still open");

    // 5. disconnect: the next invoice has no card
    const [name, value] = auth.cookie.split("=");
    await page.context().addCookies([{ name, value, url: baseUrl }]);
    await page.goto("/settings");
    await page.locator("[data-cy='stripe-disconnect']").click();
    await page.locator("[data-cy='stripe-connect']").waitFor({
      timeout: 15_000,
    });
    await page.context().clearCookies();
    await page.goto(`/i/${inv2.id}`);
    await page.locator("[data-cy='claim-form']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='pay-by-card']").count(),
      0,
      "no card without Stripe (and no card pay link)",
    );
    expect.eq(
      await page.locator("[data-cy='claim-method-card']").count(),
      1,
      "the manual card chip is back",
    );
  }));
