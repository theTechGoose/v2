/**
 * REQ-626 — "How will they edit things because the open card does not work."
 * In a browser, each list card's Open does something: the client card's
 * Open card opens the client's sheet (Edit, Message); the quote card's Open
 * opens the quote panel; the invoice card's Open opens the EDITABLE invoice
 * panel in-app (View as customer stays a separate link to /i/:id); the
 * payment card's buttons go to the invoice and the client.
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
    body: JSON.stringify({ language: "en", name: "Open Cards" }),
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
      // not clickable yet — the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

const visible = (page: StoryTools["page"], sel: string) => async () =>
  (await page.locator(sel).count()) > 0 &&
  await page.locator(sel).first().isVisible();

async function seed(http: StoryTools["http"], auth: Record<string, string>) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Ana Torres",
      phoneNumber: "(512) 555-0142",
      street: "725 Frederick Rd",
      city: "Rockingham",
      state: "VA",
      zip: "22801",
    }),
  })).json();
  const quote = await (await http("/api/quotes", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      summary: "Spring cleanup",
      jobName: "Spring cleanup",
      customerId: customer.id,
      lineItems: [{
        description: "Cleanup",
        quantity: 1,
        unit: "job",
        price: 45000,
      }],
      estimatedTotal: 45000,
      status: "sent",
    }),
  })).json();
  const invoice = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      status: "sent",
      jobName: "Weekly mowing",
      lineItems: [{
        description: "Mowing",
        quantity: 1,
        unit: "visit",
        price: 6500,
      }],
      amount: 6500,
    }),
  })).json();
  return { customer, quote, invoice };
}

Deno.test("REQ-626: client card → Open card opens the client's sheet with Edit and a working Message", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { customer } = await seed(http, auth);
    await page.goto("/customers");
    const card = page.locator(".ccard2", { hasText: "Ana Torres" });
    await card.waitFor({ timeout: 20_000 });
    await clickUntil(
      page,
      '.ccard2:has-text("Ana Torres") .ccard2__name',
      async () => (await page.locator(".ccard2--open").count()) > 0,
    );
    const msg = page.locator(".ccard2--open [data-cy='ccard2-message']");
    expect.eq(
      await msg.getAttribute("href"),
      "sms:+15125550142",
      "Message texts the client",
    );
    await clickUntil(
      page,
      ".ccard2--open [data-cy='ccard2-open']",
      visible(page, "[data-cy='client-sheet']"),
    );
    await expect.see("725 Frederick Rd, Rockingham, VA 22801");
    expect(
      page.url().includes(`open=${customer.id}`),
      `the sheet is a link (${page.url()})`,
    );
    expect.eq(
      await page.locator("[data-cy='client-sheet-message']").getAttribute(
        "href",
      ),
      "sms:+15125550142",
      "the sheet's Message texts the client",
    );
    await page.locator("[data-cy='client-sheet-edit']").click();
    await page.locator("[data-cy='customer-form'][data-mode='edit']").waitFor({
      timeout: 10_000,
    });
    await page.locator("[data-cy='cf-cancel']").click();
    // the deep link opens the same sheet on a fresh load
    await page.goto(`/customers?open=${customer.id}`);
    await page.locator("[data-cy='client-sheet-name']", {
      hasText: "Ana Torres",
    })
      .waitFor({ timeout: 20_000 });
  }));

Deno.test("REQ-626: quote card → Open quote opens the quote's panel; Resend answers on the card", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quote } = await seed(http, auth);
    await page.goto("/quotes");
    const card = page.locator(".qcard", { hasText: "Spring cleanup" });
    await card.waitFor({ timeout: 20_000 });
    // a quote never sent from the app is a draft: "Finish + send" resumes it in the
    // assistant conversation that holds it — none here, so it opens the quote's panel
    await expect.see("Finish + send");
    await clickUntil(
      page,
      '.qcard:has-text("Spring cleanup") [data-cy="qcard-cta"]',
      visible(page, "[data-cy='quote-open-panel']"),
    );
    await page.locator("[data-cy='quote-open-panel']", {
      hasText: "Spring cleanup",
    }).waitFor();
    expect(
      page.url().includes(`open=${quote.id}`),
      `the panel is a link (${page.url()})`,
    );
    await page.locator("[data-cy='quote-panel-close']").click();
    // the back: Resend says what happened (sent, or why not)
    await clickUntil(
      page,
      '.qcard:has-text("Spring cleanup") .qcard__title',
      async () => (await page.locator(".qcard--flipped").count()) > 0,
    );
    await page.locator(".qcard--flipped [data-cy='qcard-resend']").click();
    const note = page.locator(".qcard--flipped [data-cy='qcard-send-note']");
    await note.waitFor({ timeout: 20_000 });
    expect(
      await note.isVisible(),
      `the answer shows on the back (${await note.innerText()})`,
    );
    // and the back's Open quote opens the panel too
    await page.locator(".qcard--flipped [data-cy='qcard-open']").click();
    await page.locator("[data-cy='quote-open-panel']").waitFor({
      timeout: 10_000,
    });
  }));

Deno.test("REQ-626: invoice card → Open opens the editable invoice panel in-app; View as customer is its own /i/ link", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { invoice } = await seed(http, auth);
    await page.goto("/invoices");
    const card = page.locator(".qcard", { hasText: "Ana Torres" });
    await card.waitFor({ timeout: 20_000 });
    await clickUntil(
      page,
      '.qcard:has-text("Ana Torres") .qcard__body',
      async () => (await page.locator(".qcard--flipped").count()) > 0,
    );
    const back = page.locator(".qcard--flipped");
    expect.eq(
      await back.locator("[data-cy='invoice-view-as-customer']").getAttribute(
        "href",
      ),
      `/i/${invoice.id}`,
      "View as customer goes to the customer's page",
    );
    const pagesBefore = page.context().pages().length;
    await back.locator("[data-cy='invoice-back-open']").click();
    await page.locator("[data-cy='invoice-detail']").waitFor({
      timeout: 10_000,
    });
    expect.eq(
      page.context().pages().length,
      pagesBefore,
      "no new tab — it opens in the app",
    );
    expect(
      page.url().includes(`open=${invoice.id}`),
      `the panel is a link (${page.url()})`,
    );
    // the panel is the editable one
    await page.locator("[data-cy='invoice-edit']").waitFor();
    expect(
      !(await page.locator("[data-cy='invoice-edit']").isDisabled()),
      "Edit is live",
    );
  }));

Deno.test("REQ-626: payment card → its buttons go to the invoice and the client", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { invoice, customer } = await seed(http, auth);
    const pay = await http("/api/payments", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        invoiceId: invoice.id,
        amount: 6500,
        method: "cash", // lands at once — the Landed track, open by default
        receivedAt: new Date().toISOString(),
      }),
    });
    const payBody = await pay.text();
    expect(
      pay.ok,
      `a payment was recorded (${pay.status} ${payBody.slice(0, 120)})`,
    );
    await page.goto("/payments");
    const card = page.locator(".qcard", { hasText: "Ana Torres" });
    await card.waitFor({ timeout: 20_000 });
    await clickUntil(
      page,
      '.qcard:has-text("Ana Torres") .qcard__body',
      async () => (await page.locator(".qcard--flipped").count()) > 0,
    );
    const back = page.locator(".qcard--flipped");
    expect.eq(
      await back.locator("[data-cy='pay-card-match']").getAttribute("href"),
      `/invoices?open=${invoice.id}`,
      "Match invoice opens the invoice",
    );
    expect.eq(
      await back.locator("[data-cy='pay-card-text']").getAttribute("href"),
      `/clients?open=${customer.id}`,
      "Text client opens the client's sheet",
    );
    expect.eq(
      await back.locator("[data-cy='pay-card-receipt']").getAttribute("href"),
      `/i/${invoice.id}`,
      "Receipt is the customer's copy",
    );
    await back.locator("[data-cy='pay-card-match']").click();
    await page.locator("[data-cy='invoice-detail']").waitFor({
      timeout: 20_000,
    });
  }));
