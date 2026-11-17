/**
 * REQ-203 / REQ-205 / REQ-210 — linked documents on the real shell: the
 * quote panel's ledger (/quotes?open=), the public quote's headline, related
 * documents and signature (/q), the public invoice's "Original quote" link and
 * balance block (/i), and the work-orders pages (/work-orders, /wo/:id).
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
    body: JSON.stringify({ language: "en", name: "Ledger Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
    } catch {
      // the button is gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

/** a customer, a sent Q-001 for $1,000.00, and INV-001 for $400.00 against it */
async function seedAgreement(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await post(http, auth, "/api/customers", {
    name: "Hans Hansen",
    email: "hans@blackhole.postmarkapp.com",
    address: "725 Frederick Rd, Rockingham, VA",
  });
  const quote = await post(http, auth, "/api/quotes", {
    customerId: customer.id,
    summary: "Deck rebuild — Hans Hansen",
    jobName: "Deck rebuild",
    description: "Tear out and rebuild the back deck.",
    lineItems: [{
      description: "Deck rebuild",
      quantity: 1,
      unit: "job",
      price: 100000,
    }],
    estimatedTotal: 100000,
    status: "draft",
  });
  const sent = await http(`/api/quotes/${quote.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ status: "sent" }),
  });
  await sent.body?.cancel();
  const invoice = await post(http, auth, "/api/invoices", {
    customerId: customer.id,
    quoteId: quote.id,
    amount: 40000,
    dueDate: "2026-12-01",
    issuedDate: "2026-11-06",
    status: "sent",
    jobName: "Deck rebuild",
  });
  return { customer, quote, invoice };
}

Deno.test("REQ-205 / REQ-249: the quote panel shows the documents ledger — Q-001 · Version 1, Quoted $1,000.00 (sent, not signed), Invoiced $400.00, Remaining to invoice $600.00, the INV-001 row and the WO-001 row", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { customer, quote, invoice } = await seedAgreement(http, auth);
    const wo = await post(http, auth, "/api/work-orders", {
      description: "Demo the old deck",
      customerId: customer.id,
      quoteId: quote.id,
      assignee: "Luis",
      scheduledFor: "2026-11-10",
      requestId: crypto.randomUUID(),
    });
    expect.eq(wo.number, "WO-001", "the work order is WO-001");

    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-ledger']").waitFor({ timeout: 15_000 });
    await expect.see("Q-001 · Version 1");
    await expect.see("Quoted $1,000.00");
    await expect.see("Invoiced $400.00");
    await expect.see("Remaining to invoice $600.00");
    const invRow = page.locator("[data-cy='ledger-invoice-row']", {
      hasText: "INV-001",
    });
    expect.eq(await invRow.count(), 1, "the INV-001 row is in the ledger");
    expect(
      ((await invRow.first().getAttribute("href")) ?? "").includes(
        `/invoices?open=${invoice.id}`,
      ),
      "the invoice row opens the invoice panel",
    );
    const woRow = page.locator("[data-cy='ledger-wo-row']", {
      hasText: "WO-001",
    });
    expect.eq(await woRow.count(), 1, "the WO-001 row is in the ledger");
    await expect.see("Luis");
    const next = page.locator("[data-cy='quote-create-next-invoice']");
    expect.eq(await next.count(), 1, "the next-invoice CTA is there");
    expect(
      ((await next.getAttribute("href")) ?? "").includes(
        `/invoices?new=1&quoteId=${quote.id}`,
      ),
      "the CTA pre-links the quote",
    );
  }));

Deno.test("REQ-249: an unsigned quote's ledger reads 'Quoted $1,000.00' and never 'Agreed'; once the customer signs, the same row reads 'Agreed $1,000.00' (demo quote-invoice-money-m10)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quote } = await seedAgreement(http, auth);
    const totals = page.locator("[data-cy='quote-ledger-totals']");

    await page.goto(`/quotes?open=${quote.id}`);
    await totals.waitFor({ timeout: 15_000 });
    await expect.see("Quoted $1,000.00");
    expect.eq(
      await totals.getByText("Agreed").count(),
      0,
      "nothing on an unsigned quote is called agreed",
    );

    const signed = await http(`/api/quotes/${quote.id}/accept`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Hans Hansen", version: 1 }),
    });
    expect.eq(signed.status, 200, "the customer signs Q-001");
    await signed.body?.cancel();

    await page.goto(`/quotes?open=${quote.id}`);
    await totals.waitFor({ timeout: 15_000 });
    await expect.see("Agreed $1,000.00");
    expect.eq(
      await totals.getByText("Quoted").count(),
      0,
      "a signed quote is no longer just quoted",
    );
  }));

Deno.test("REQ-203: the public quote shows 'Q-001 · Version 1', lists INV-001 under Related documents, and signing it shows 'Accepted and signed' with the drawn signature", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quote, invoice } = await seedAgreement(http, auth);

    await page.goto(`/q/${quote.id}`);
    await page.locator("[data-cy='quote-doc-headline']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Q-001 · Version 1");
    const related = page.locator("[data-cy='related-doc-invoice']", {
      hasText: "INV-001",
    });
    expect.eq(
      await related.count(),
      1,
      "INV-001 is listed under Related documents",
    );
    expect.eq(
      await related.getAttribute("href"),
      `/i/${invoice.id}`,
      "the related row links the public invoice",
    );
    await expect.see("$400.00");

    // sign it in the browser through PublicSignQuote: type the legal name, submit
    const form = page.locator("form.ctr__sign-form");
    await form.waitFor({ timeout: 15_000 });
    await form.locator("input[type='text']").fill("Hans Hansen");
    await clickUntil(
      page,
      "form.ctr__sign-form button[type='submit']",
      async () => (await page.getByText("Accepted and signed").count()) > 0,
    );
    await expect.see("Accepted and signed");
    await page.locator("[data-cy='quote-signature-image']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Hans Hansen");
    const q = await (await http(`/api/quotes/${quote.id}`, { headers: auth }))
      .json();
    expect.eq(q.status, "accepted", "the quote is accepted on the API");
  }));

Deno.test("REQ-205: the public invoice links its original quote by number and shows the balance block — $400.00 due", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quote, invoice } = await seedAgreement(http, auth);

    await page.goto(`/i/${invoice.id}`);
    const link = page.locator("[data-cy='invoice-quote-link']");
    await link.waitFor({ timeout: 15_000 });
    await expect.see("Original quote: Q-001");
    expect.eq(
      await link.getAttribute("href"),
      `/q/${quote.id}`,
      "the link opens the public quote",
    );
    await expect.see("INV-001 · Version 1");
    const due = page.locator("[data-cy='invoice-balance-due']");
    expect.eq(
      (await due.innerText()).trim(),
      "$400.00",
      "the balance due is $400.00",
    );
    await expect.see("Balance due");
  }));

Deno.test("REQ-210: a work order linked to the quote is listed on /work-orders as WO-001 with its quote number, and its detail page walks it to In progress", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { customer, quote } = await seedAgreement(http, auth);
    const wo = await post(http, auth, "/api/work-orders", {
      description: "Demo the old deck",
      customerId: customer.id,
      quoteId: quote.id,
      assignee: "Luis",
      scheduledFor: "2026-11-10",
      requestId: crypto.randomUUID(),
    });

    await page.goto("/work-orders");
    const row = page.locator("[data-cy='wo-row']", { hasText: "WO-001" });
    await row.waitFor({ timeout: 15_000 });
    await expect.see("Demo the old deck");
    await expect.see("Hans Hansen");
    const qlink = row.locator("a", { hasText: "Q-001" });
    expect.eq(await qlink.count(), 1, "the row links the quote by number");

    await page.goto(`/wo/${wo.id}`);
    await page.locator("[data-cy='wo-status']").waitFor({ timeout: 15_000 });
    await expect.see("WO-001");
    await clickUntil(
      page,
      "[data-cy='wo-set-status-in_progress']",
      async () => ((await page.locator("[data-cy='wo-status']").innerText())
        .trim().toLowerCase() === "in progress"),
    );
    const after =
      await (await http(`/api/work-orders/${wo.id}`, { headers: auth })).json();
    expect.eq(
      after.status,
      "in_progress",
      "the status change landed on the API",
    );
    expect.eq(after.version, 2, "the change is a new version");
  }));

Deno.test("REQ-457 (demo M27, cycle 3): a signed Q-001 with a pending CO-001 (+$120.00) shows 'waiting for your approval — new job total $1,120.00' and lists CO-001 under Related documents, linking /co/:id", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quote, invoice } = await seedAgreement(http, auth);

    const signed = await http(`/api/quotes/${quote.id}/accept`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Hans Hansen", version: 1 }),
    });
    expect.eq(signed.status, 200, "the customer signs Q-001");
    await signed.body?.cancel();
    const co = await post(
      http,
      auth,
      `/api/invoices/${invoice.id}/change-orders`,
      { description: "Add stair railing", deltaAmountCents: 12000 },
    );

    await page.goto(`/q/${quote.id}`);
    const banner = page.locator("[data-cy='quote-pending-change-order']");
    await banner.first().waitFor({ timeout: 15_000 });
    const text = (await banner.first().innerText()).replace(/\s+/g, " ");
    expect(
      text.includes(
        "A change order (CO-001, +$120.00) is waiting for your approval — new job total $1,120.00",
      ),
      `the banner names the CO and the new total (got "${text}")`,
    );
    expect.eq(
      await banner.first().locator("a").getAttribute("href"),
      `/co/${co.id}`,
      "the banner links the change order to approve",
    );
    const row = page.locator("[data-cy='related-doc-change-order']", {
      hasText: "CO-001",
    });
    expect.eq(await row.count(), 1, "CO-001 is listed under Related documents");
    expect.eq(
      await row.getAttribute("href"),
      `/co/${co.id}`,
      "the related row links the public change order",
    );
    await expect.see("Waiting for your approval");
  }));
