/**
 * REQ-462 (demo-loop cycle 3, M26) — the signed quote's panel on /quotes:
 *
 *  - "Signed — later changes go on a change order" has a "New change order"
 *    button next to it; with no open invoice it says what comes first;
 *  - the form puts the change order on the quote's open invoice (CO-001,
 *    pending, approved by the customer at its own link);
 *  - the pending row has Edit (saved as Version 2, back to pending) and
 *    Withdraw (asks first, then it is gone).
 *
 * REQ-684 (demo-loop cycle 5, m39): after Create and after Save the panel
 * says what the alert delivered to the customer ("Sent CO-001 to Karen Mills
 * by email (…)"), as the chat does.
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
    body: JSON.stringify({ language: "en", name: "Change Order Story" }),
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

async function call(
  http: StoryTools["http"],
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
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

Deno.test("REQ-462 M26: a signed quote's panel makes a change order next to 'Signed — later changes go on a change order', and its pending row can be edited (Version 2) and withdrawn", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const karen = await call(http, auth, "POST", "/api/customers", {
      name: "Karen Mills",
      email: "karen@blackhole.postmarkapp.com",
      address: "18 Oak St, Austin, TX",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: karen.id,
      summary: "Bathroom Remodel — Karen Mills",
      jobName: "Bathroom Remodel",
      lineItems: [{
        description: "Bathroom remodel",
        quantity: 1,
        unit: "job",
        price: 705000,
      }],
      estimatedTotal: 705000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    // the customer signs (no session — the public accept)
    await call(http, JSON_HEADERS, "POST", `/api/quotes/${quote.id}/accept`, {
      name: "Karen Mills",
      version: 1,
    });
    // signing bills its first invoice; take every invoice away so the panel
    // has none open
    const ledger0 = await call(
      http,
      auth,
      "GET",
      `/api/quotes/${quote.id}/ledger`,
    );
    for (const i of ledger0.invoices) {
      await call(http, auth, "DELETE", `/api/invoices/${i.id}`);
    }

    // 1) the button is next to the lock note; with no open invoice it says
    //    to invoice first (the chat's REQ-238 rule) — no dead end, no write
    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-lock-note']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Signed — later changes go on a change order");
    const firstNote = page.locator("[data-cy='quote-co-invoice-first']");
    await clickUntil(
      page,
      "[data-cy='quote-new-change-order']",
      async () => (await firstNote.count()) > 0,
    );
    expect.eq(
      await page.locator("[data-cy='quote-co-form']").count(),
      0,
      "no form without an open invoice",
    );

    // 2) with an open invoice, the form puts CO-001 on it
    const invoice = await call(http, auth, "POST", "/api/invoices", {
      customerId: karen.id,
      quoteId: quote.id,
      amount: 705000,
      status: "sent",
      jobName: "Bathroom Remodel",
    });
    await page.goto(`/quotes?open=${quote.id}`);
    const form = page.locator("[data-cy='quote-co-form']");
    await page.locator("[data-cy='quote-lock-note']").waitFor({
      timeout: 15_000,
    });
    await clickUntil(
      page,
      "[data-cy='quote-new-change-order']",
      async () => (await form.count()) > 0,
    );
    expect(
      (await form.innerText()).includes(invoice.number),
      `the form says the order goes on ${invoice.number}`,
    );
    await page.locator("[data-cy='quote-co-desc']").fill(
      "Frameless glass shower door upgrade",
    );
    await page.locator("[data-cy='quote-co-amount']").fill("1200");
    await page.locator("[data-cy='quote-co-create']").click();
    const row = page.locator("[data-cy='ledger-co-row']", {
      hasText: "CO-001",
    });
    await row.waitFor({ timeout: 15_000 });
    expect(
      (await row.innerText()).includes("+$1,200.00"),
      "CO-001 is +$1,200.00",
    );
    expect(
      (await row.innerText()).includes(`on ${invoice.number}`),
      "on the open invoice",
    );
    // REQ-684 (cycle 5, m39): the panel says the alert reached Karen — the
    // chat's "Sent CO-001 to … by email (…)", not a bare "created"
    const sent = page.locator("[data-cy='quote-co-delivery']");
    await sent.waitFor({ timeout: 15_000 });
    expect(
      (await sent.innerText()).includes(
        "Sent CO-001 to Karen Mills by email (karen@blackhole.postmarkapp.com)",
      ),
      `the panel says CO-001 was emailed to Karen: ${await sent.innerText()}`,
    );
    const listed = await call(
      http,
      auth,
      "GET",
      `/api/invoices/${invoice.id}/change-orders`,
    );
    expect.eq(listed.length, 1, "one change order on the invoice");
    expect.eq(listed[0].status, "pending", "it waits for Karen");
    expect.eq(
      listed[0].description,
      "Frameless glass shower door upgrade",
      "its wording",
    );

    // 3) Edit → $1,000 and the new wording → Version 2, still pending
    await row.locator("[data-cy='ledger-co-edit']").click();
    const desc = page.locator("[data-cy='ledger-co-edit-desc']");
    await desc.waitFor({ timeout: 10_000 });
    expect.eq(
      await desc.inputValue(),
      "Frameless glass shower door upgrade",
      "the editor starts from the order's wording",
    );
    await desc.fill("Upgrade to frameless glass shower door");
    await page.locator("[data-cy='ledger-co-edit-amount']").fill("1000");
    await page.locator("[data-cy='ledger-co-edit-save']").click();
    await page.locator("[data-cy='ledger-co-row']", { hasText: "Version 2" })
      .waitFor({ timeout: 15_000 });
    // REQ-684: the re-sent alert says what reached Karen too
    const resent = page.locator("[data-cy='ledger-co-delivery']");
    await resent.waitFor({ timeout: 15_000 });
    expect(
      (await resent.innerText()).includes("Sent CO-001 to Karen Mills by email"),
      `the saved note says the edit was emailed: ${await resent.innerText()}`,
    );
    const edited = page.locator("[data-cy='ledger-co-row']", {
      hasText: "CO-001",
    });
    expect(
      (await edited.innerText()).includes("+$1,000.00"),
      "CO-001 is now +$1,000.00",
    );
    expect(
      (await edited.innerText()).includes(
        "Upgrade to frameless glass shower door",
      ),
      "with the new wording",
    );
    const after = await call(
      http,
      auth,
      "GET",
      `/api/invoices/${invoice.id}/change-orders`,
    );
    expect.eq(after[0].version, 2, "the edit is Version 2");
    expect.eq(after[0].status, "pending", "back to pending for Karen");
    expect.eq(after[0].deltaAmountCents, 100000, "$1,000.00");

    // 4) Withdraw asks first, then the order is gone
    await edited.locator("[data-cy='ledger-co-withdraw']").click();
    await page.locator("[data-cy='ledger-co-withdraw-confirm']").click();
    await page.locator("[data-cy='ledger-co-row']").waitFor({
      state: "detached",
      timeout: 15_000,
    });
    expect.eq(
      (await call(
        http,
        auth,
        "GET",
        `/api/invoices/${invoice.id}/change-orders`,
      )).length,
      0,
      "CO-001 is withdrawn",
    );
  }));
