/**
 * REQ-565 (demo-loop cycle 4, m33) — a change order reaches the customer:
 *
 *  - its row on the signed quote's panel has Copy link, Text, Email and View
 *    as customer (each carrying its own /co link) and says the customer also
 *    sees it as a banner on her quote link;
 *  - the customer's card lists the change orders, and the quote at its agreed
 *    total (the quote plus its approved change orders).
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
    body: JSON.stringify({ language: "en", name: "Change Order Surfaces" }),
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

Deno.test("REQ-565 m33: a change order's row has Copy link / Text / Email / View as customer and the banner line; the customer's card lists the change orders and the quote at its agreed total", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const maria = await call(http, auth, "POST", "/api/customers", {
      name: "Maria Lopez",
      phoneNumber: "(512) 555-0142",
      email: "maria@blackhole.postmarkapp.com",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: maria.id,
      summary: "Bathroom Remodel — Maria Lopez",
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
    await call(http, JSON_HEADERS, "POST", `/api/quotes/${quote.id}/accept`, {
      name: "Maria Lopez",
      version: 1,
    });
    // signing bills its first invoice — the change orders land on it
    const ledger = await call(
      http,
      auth,
      "GET",
      `/api/quotes/${quote.id}/ledger`,
    );
    const invoice = ledger.invoices[0];
    if (!invoice) throw new Error("signing billed no invoice");
    const approved = await call(
      http,
      auth,
      "POST",
      `/api/invoices/${invoice.id}/change-orders`,
      { description: "Frameless glass door", deltaAmountCents: 120000 },
    );
    // Maria approves it at her own link (no session)
    await call(
      http,
      JSON_HEADERS,
      "POST",
      `/api/change-orders/${approved.id}/approve`,
      { name: "Maria Lopez" },
    );
    const pending = await call(
      http,
      auth,
      "POST",
      `/api/invoices/${invoice.id}/change-orders`,
      { description: "Towel bar", deltaAmountCents: 15000 },
    );

    // 1) the pending row on the quote panel
    await page.goto(`/quotes?open=${quote.id}`);
    const row = page.locator("[data-cy='ledger-co-row']", {
      hasText: pending.number,
    });
    await row.waitFor({ timeout: 15_000 });
    const coPath = `/co/${pending.id}`;
    const text = await row.locator("[data-cy='ledger-co-text']")
      .getAttribute("href");
    expect(
      (text ?? "").startsWith("sms:+15125550142?body="),
      `Text goes to Maria's phone (${text})`,
    );
    expect(
      decodeURIComponent(text ?? "").includes(coPath),
      `the text carries ${coPath}`,
    );
    const mail = await row.locator("[data-cy='ledger-co-email']")
      .getAttribute("href");
    expect(
      (mail ?? "").startsWith("mailto:maria@blackhole.postmarkapp.com?"),
      `Email goes to Maria (${mail})`,
    );
    expect(
      decodeURIComponent(mail ?? "").includes(coPath),
      `the email carries ${coPath}`,
    );
    expect.eq(
      await row.locator("[data-cy='ledger-co-view']").getAttribute("href"),
      coPath,
      "View as customer opens the change order's own page",
    );
    expect.eq(
      await row.locator("[data-cy='ledger-co-copy']").count(),
      1,
      "Copy link is on the row",
    );
    expect(
      (await row.innerText()).includes(
        "Maria Lopez also sees it as a banner on the quote link",
      ),
      "the row says she also sees it on her quote link",
    );

    // 2) the customer's card lists both change orders, and the quote at
    //    $7,050 + $1,200 approved = $8,250
    await page.goto("/customers");
    await expect.see("Maria Lopez");
    const card = page.locator(".ccard2", { hasText: "Maria Lopez" });
    await clickUntil(
      page,
      ".ccard2:has-text('Maria Lopez') .ccard2__name",
      async () =>
        (await card.getAttribute("class"))?.includes("ccard2--open") ?? false,
    );
    const docs = card.locator("[data-cy='ccard2-doc']");
    const all = (await docs.allInnerTexts()).join("\n");
    expect(all.includes(approved.number), `${approved.number} is listed`);
    expect(all.includes(pending.number), `${pending.number} is listed`);
    expect(
      all.toLowerCase().includes("change order ·"),
      "labelled as a change order",
    );
    expect(
      all.includes("$8,250.00"),
      `the quote at the agreed total ($8,250.00): ${all}`,
    );
    expect(
      all.includes("incl. +$1,200.00 in change orders"),
      `the quote row says what the change orders added: ${all}`,
    );
  }));

Deno.test("REQ-565 m33: 'Revision published' shows after Publish and is gone once the customer signs (the panel stays open)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const dana = await call(http, auth, "POST", "/api/customers", {
      name: "Dana Whitfield",
      email: "dana@blackhole.postmarkapp.com",
    });
    const line = (price: number) => [{
      description: "Deck stain",
      quantity: 1,
      unit: "job",
      price,
    }];
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: dana.id,
      summary: "Deck stain — Dana Whitfield",
      jobName: "Deck stain",
      lineItems: line(40000),
      estimatedTotal: 40000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    // an edit on the sent quote is filed as an unpublished Version 2
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      lineItems: line(45000),
      estimatedTotal: 45000,
    });

    await page.goto(`/quotes?open=${quote.id}`);
    await clickUntil(
      page,
      "[data-cy='quote-publish']",
      async () =>
        (await page.locator("[data-cy='quote-publish-confirm']").count()) > 0,
    );
    await page.locator("[data-cy='quote-publish-confirm']").click();
    const note = page.locator("[data-cy='quote-published-note']");
    await note.waitFor({ timeout: 45_000 });
    await expect.see("Revision published");

    // Dana signs Version 2 at her link; the open panel follows the change
    await call(http, JSON_HEADERS, "POST", `/api/quotes/${quote.id}/accept`, {
      name: "Dana Whitfield",
      version: 2,
    });
    await page.locator("[data-cy='quote-lock-note']").waitFor({
      timeout: 20_000,
    });
    expect.eq(
      await note.count(),
      0,
      "the 'Revision published' note is gone once the quote is signed",
    );
  }));
