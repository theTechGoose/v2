/**
 * REQ-201 / REQ-206 on the real shell — the standalone invoice form, the
 * number · version · state headline, the pending-revision publish, the paid
 * lock, and the quote-ledger deep link into the form.
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
    body: JSON.stringify({ language: "en", name: "Numbering Story" }),
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
      await page.locator(selector).first().click({ timeout: 2_000 });
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

async function mkCustomer(
  http: StoryTools["http"],
  auth: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  return await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Ann Lee",
      email: "ann.lee@blackhole.postmarkapp.com",
      phoneNumber: "+15125550199",
      address: "1 Main St, Austin, TX 78701",
      ...extra,
    }),
  })).json();
}

Deno.test("REQ-206: the standalone invoice form — customer prefills bill-to, two lines + 8.25% tax + net 15 issue as 'INV-001 · Version 1 · Sent'; REQ-201: an edit waits as unpublished changes, publishing makes Version 2, a paid invoice is locked", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await mkCustomer(http, auth);

    await page.goto("/invoices");
    await clickUntil(
      page,
      "[data-cy='invoice-new']",
      async () =>
        await page.locator("[data-cy='new-invoice-modal']").isVisible(),
    );
    // REQ-801: the client field is the search-and-pick — type the name, click the match
    const clientBox = page.locator(
      "[data-cy='new-invoice-client'] [data-cy='search-select-input']",
    );
    await clientBox.waitFor({ timeout: 15_000 });
    await clientBox.fill("Ann");
    await page.locator(
      "[data-cy='new-invoice-client'] [data-cy='search-select-option']",
    ).filter({ hasText: "Ann Lee" }).first().click();
    expect.eq(
      await page.locator(
        "[data-cy='new-invoice-client'] input[name='customerId']",
      ).inputValue(),
      customer.id,
      "the picked client's id is the field's value",
    );
    // the customer prefills the bill-to and the service address
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-bill-email']") as
        | HTMLInputElement
        | null)?.value ===
        "ann.lee@blackhole.postmarkapp.com"
    );
    expect.eq(
      await page.locator("[data-cy='new-invoice-bill-name']").inputValue(),
      "Ann Lee",
      "bill-to name comes from the customer",
    );
    expect.eq(
      await page.locator("[data-cy='new-invoice-service-address']")
        .inputValue(),
      "1 Main St, Austin, TX 78701",
      "the service address starts as the customer's address",
    );
    await page.locator("[data-cy='new-invoice-jobname']").fill("Fence repair");
    // two line items
    await page.locator("[data-cy='new-invoice-line-add']").click();
    await page.locator("[data-cy='new-invoice-line-desc-0']").fill("Labor");
    await page.locator("[data-cy='new-invoice-line-qty-0']").fill("2");
    await page.locator("[data-cy='new-invoice-line-price-0']").fill("150");
    await page.locator("[data-cy='new-invoice-line-add']").click();
    await page.locator("[data-cy='new-invoice-line-desc-1']").fill("Parts");
    await page.locator("[data-cy='new-invoice-line-qty-1']").fill("1");
    await page.locator("[data-cy='new-invoice-line-price-1']").fill("49.99");
    await page.locator("[data-cy='new-invoice-tax']").fill("8.25");
    await page.locator("[data-cy='new-invoice-terms']").selectOption("15");
    // 34999 − 0 = 34999 · tax 2887 · total 37886
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-total']")?.textContent ??
        "").includes("$378.86")
    );
    expect.eq(
      await page.locator("[data-cy='new-invoice-subtotal']").innerText(),
      "$349.99",
      "the subtotal is the sum of the lines",
    );
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(`${today}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 15);
    expect.eq(
      await page.locator("[data-cy='new-invoice-due']").inputValue(),
      due.toISOString().slice(0, 10),
      "net 15 sets the due date from the issue date",
    );
    await page.locator("[data-cy='new-invoice-submit']").click();
    // REQ-727 (cycle 5, c4-M16): the send sheet opens on the new invoice —
    // nothing is sent until its Send.
    await page.locator("[data-cy='send-dialog']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='send-keep']").click();
    // the page reloads onto the list
    await page.locator("[data-cy='invoice-card-headline']").first().waitFor({
      timeout: 15_000,
    });
    await expect.see("INV-001 · Version 1 · Sent");
    await expect.see("$379");

    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json() as Array<
        Record<string, unknown>
      >;
    expect.eq(
      invoices.length,
      1,
      "one invoice was created (one requestId per form)",
    );
    const inv = invoices[0];
    expect.eq(inv.number, "INV-001", "the invoice carries its number");
    expect.eq(inv.amount, 37886, "the amount is the computed total in cents");
    expect.eq(inv.taxRateBp, 825, "the tax rate is stored in basis points");
    expect.eq(inv.taxCents, 2887, "the tax is stored in cents");
    expect.eq(inv.netDays, 15, "the terms are stored");
    expect.eq(inv.status, "sent", "issued, not drafted");
    expect.eq(
      (inv.billTo as { email?: string })?.email,
      "ann.lee@blackhole.postmarkapp.com",
      "bill-to is stored",
    );

    // REQ-201: edit a line item on the sent invoice → unpublished changes
    await page.goto(`/invoices?open=${inv.id}`);
    await page.locator("[data-cy='invoice-headline']").waitFor({
      timeout: 15_000,
    });
    await expect.see("INV-001 · Version 1 · Sent");
    await clickUntil(
      page,
      "[data-cy='invoice-edit']",
      async () =>
        await page.locator("[data-cy='invoice-edit-form']").isVisible(),
    );
    await page.locator("[data-cy='invoice-edit-line-price-1']").fill("59.99");
    await page.locator("[data-cy='invoice-edit-save']").click();
    // the badge shows on the detail headline AND on the list card below it
    await page.locator("[data-cy='invoice-unpublished']").first().waitFor({
      timeout: 15_000,
    });
    await expect.see("Unpublished changes");
    // publish + notify → version 2
    await clickUntil(
      page,
      "[data-cy='invoice-publish-notify']",
      async () =>
        (await page.locator("[data-cy='invoice-headline']").innerText())
          .includes("Version 2"),
    );
    await expect.see(
      "INV-001 · Version 2 · Revised invoice — replaces previous version",
    );
    await expect.see("Version 2 published and sent to Ann Lee");
    expect.eq(
      await page.locator("[data-cy='invoice-unpublished']").count(),
      0,
      "the badge is gone once published",
    );
    const v2 = await (await http(`/api/invoices/${inv.id}`, { headers: auth }))
      .json();
    expect.eq(v2.version, 2, "the API says version 2");
    expect.eq(v2.pendingRevision, undefined, "nothing pending");

    // REQ-202: pay it in full over HTTP → locked
    const pay = await http("/api/payments", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        invoiceId: inv.id,
        amount: v2.amount,
        method: "check",
        receivedAt: new Date().toISOString(),
      }),
    });
    await pay.body?.cancel();
    expect.eq(pay.status, 200, "the payment landed");
    await page.goto(`/invoices?open=${inv.id}`);
    await page.locator("[data-cy='invoice-locked']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Paid invoices are locked");
    expect(
      await page.locator("[data-cy='invoice-edit']").isDisabled(),
      "edit is disabled on a paid invoice",
    );
    // REQ-485 (m22): Delete is not offered at all on a paid invoice.
    expect.eq(
      await page.locator("[data-cy='invoice-delete']").count(),
      0,
      "no delete on a paid invoice",
    );
    expect(
      await page.locator("[data-cy='invoice-discount-btn']").isDisabled(),
      "discount is disabled on a paid invoice",
    );
    await expect.see("INV-001 · Version 2 · Paid");
  }));

Deno.test("REQ-206: /invoices?new=1&quoteId=<id> prefills the form from the quote's ledger — Original quote Q-001 · Agreed $1,000.00 · Invoiced $400.00 · Remaining $600.00", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await mkCustomer(http, auth, { name: "Bob Quote" });
    const quote = await (await http("/api/quotes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        summary: "Roof replacement",
        jobName: "Roof",
        customerId: customer.id,
        lineItems: [{
          description: "Shingles",
          quantity: 1,
          unit: "job",
          price: 100000,
        }],
        estimatedTotal: 100000,
        status: "sent",
      }),
    })).json();
    const first = await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        quoteId: quote.id,
        customerId: customer.id,
        amount: 40000,
        status: "sent",
        jobName: "Roof",
      }),
    });
    await first.body?.cancel();
    expect.eq(first.status, 200, "the first (40%) invoice exists");

    await page.goto(`/invoices?new=1&quoteId=${quote.id}`);
    await page.locator("[data-cy='new-invoice-ledger']").waitFor({
      timeout: 15_000,
    });
    const ledgerText = await page.locator("[data-cy='new-invoice-ledger']")
      .innerText();
    expect(
      ledgerText.includes("Q-001"),
      `the quote's number is named (${ledgerText})`,
    );
    // REQ-409: a quote not yet accepted reads "Quoted", an accepted one "Agreed"
    expect(
      /(Agreed|Quoted) \$1,000\.00/.test(ledgerText),
      `agreed total (${ledgerText})`,
    );
    expect(
      ledgerText.includes("Invoiced $400.00"),
      `invoiced so far (${ledgerText})`,
    );
    expect(
      ledgerText.includes("Remaining $600.00"),
      `remaining to invoice (${ledgerText})`,
    );
    expect.eq(
      await page.locator("[data-cy='new-invoice-amount']").inputValue(),
      "600.00",
      "the amount is prefilled with what remains",
    );
    // the pick lands once the customers list has arrived (its own fetch)
    await page.waitForFunction(
      (id) =>
        (document.querySelector(
          "[data-cy='new-invoice-client'] input[name='customerId']",
        ) as HTMLInputElement | null)?.value === id,
      customer.id,
      { timeout: 15_000 },
    );
    expect.eq(
      await page.locator(
        "[data-cy='new-invoice-client'] input[name='customerId']",
      ).inputValue(),
      customer.id,
      "the quote's customer is picked",
    );
    expect.eq(
      await page.locator("[data-cy='new-invoice-jobname']").inputValue(),
      "Roof",
      "the quote's job name is carried",
    );
    // save it as a draft: the quote link travels in the POST body
    await page.locator("[data-cy='new-invoice-draft']").click();
    await page.locator("[data-cy='invoice-card-headline']").first().waitFor({
      timeout: 15_000,
    });
    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json() as Array<
        Record<string, unknown>
      >;
    const draft = invoices.find((i) => i.status === "draft");
    expect(draft !== undefined, "the draft exists");
    expect.eq(draft?.quoteId, quote.id, "the draft is linked to the quote");
    expect.eq(draft?.amount, 60000, "the draft bills the remaining $600");
    expect.eq(draft?.number, "INV-002", "the second invoice is INV-002");
  }));
