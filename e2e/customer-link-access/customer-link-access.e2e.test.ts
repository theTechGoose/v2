/**
 * REQ-310 (demo cycle 1, m13 + m32) — the customer's link is one click away
 * after a send, and "Copy link" says what it did.
 *
 *   /quotes: pressing the FRONT CTA of a sent card opens the quote panel
 *            (?open=<id>) — before, the button only swallowed the click.
 *   /assistant/<id>: after a send the chat shows a persistent
 *            "Customer link · Copy · Open as customer" row under the send
 *            divider, and pressing Copy shows a toast outside the menu.
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
  for (
    const [path, payload] of [
      ["/api/me", { language: "en", name: "Link Story" }],
      ["/api/profile/identity", { businessName: "Link Business" }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
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
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

/** an island may still be hydrating when its target appears: click until the page shows the effect */
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
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

async function seedQuote(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await post(http, auth, "/api/customers", {
    name: "Lena Link",
    email: "lena@blackhole.postmarkapp.com",
  });
  const quote = await post(http, auth, "/api/quotes", {
    customerId: customer.id,
    summary: "Deck staining — Lena Link",
    jobName: "Deck staining",
    description: "Stain the back deck.",
    lineItems: [{
      description: "Deck staining",
      quantity: 1,
      unit: "job",
      price: 40000,
    }],
    estimatedTotal: 40000,
    status: "draft",
  });
  return { customer, quote };
}

Deno.test("REQ-310 (m13): /quotes — the front CTA of a sent card opens the quote panel without flipping", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quote } = await seedQuote(http, auth);
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    });
    await sent.body?.cancel();

    await page.goto("/quotes");
    const card = page.locator(".qcard", { hasText: "Deck staining" });
    await card.first().waitFor({ timeout: 15_000 });
    const panel = page.locator("[data-cy='quote-open-panel']");
    expect.eq(await panel.count(), 0, "no panel before the CTA is pressed");

    await clickUntil(
      page,
      ".qcard:has-text('Deck staining') [data-cy='qcard-cta']",
      async () => (await panel.count()) > 0,
    );
    await panel.waitFor({ timeout: 15_000 });
    expect(
      !(await card.first().getAttribute("class") ?? "").includes(
        "qcard--flipped",
      ),
      "the CTA opened the panel directly — the card did not have to flip",
    );
    expect(
      page.url().includes(`open=${quote.id}`),
      "the address bar carries ?open=<id>",
    );
  }));

Deno.test("REQ-310 (m13 + m32): /assistant after a send — the customer-link row is in the chat and Copy shows a toast outside the menu", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { customer, quote } = await seedQuote(http, auth);
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
      customerId: customer.id,
    });
    await post(http, auth, `/api/agents/conversations/${conv.id}/send-quote`, {
      quoteId: quote.id,
      channel: "email",
      language: "en",
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conv.id}`);
    const row = page.locator("[data-cy='customer-link']").first();
    await row.waitFor({ state: "visible", timeout: 20_000 });
    const href = await row.locator("[data-cy='customer-link-open']")
      .getAttribute("href");
    expect.eq(href, `/q/${quote.id}`, "Open as customer links to /q/<id>");
    expect.eq(
      await page.locator(".quote-review__send-menu").count(),
      0,
      "the row is not inside the send channel menu",
    );

    const toast = page.locator("[data-cy='link-toast']");
    await clickUntil(
      page,
      "[data-cy='customer-link'] [data-cy='customer-link-copy']",
      async () => (await toast.count()) > 0,
    );
    await toast.waitFor({ state: "visible", timeout: 10_000 });
    const text = (await toast.innerText()).trim();
    expect(
      /link copied|couldn.t copy/i.test(text),
      `the toast says what happened: "${text}"`,
    );
    if (/couldn.t copy/i.test(text)) {
      const url = (await toast.locator("[data-cy='link-toast-url']")
        .innerText()).trim();
      expect(url.endsWith(`/q/${quote.id}`), `the url is on the toast: ${url}`);
    }
  }));

Deno.test("REQ-472 (demo cycle 3, p8-pair5-c): /assistant after a send — the customer-link row names the document, not the raw /q/<uuid>", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { customer, quote } = await seedQuote(http, auth);
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
      customerId: customer.id,
    });
    await post(http, auth, `/api/agents/conversations/${conv.id}/send-quote`, {
      quoteId: quote.id,
      channel: "email",
      language: "en",
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conv.id}`);
    const row = page.locator("[data-cy='customer-link']").first();
    await row.waitFor({ state: "visible", timeout: 20_000 });
    const shown = row.locator(".customer-link__path");
    // the quote's number arrives with the island's quote fetch
    const number = String(quote.number ?? "");
    expect(/^Q-\d+/.test(number), `the seeded quote has a number: ${number}`);
    await page.waitForFunction(
      (n) =>
        document.querySelector("[data-cy='customer-link'] .customer-link__path")
          ?.textContent?.trim() === n,
      number,
      { timeout: 15_000 },
    );
    const text = (await row.innerText()).trim();
    expect(!text.includes(quote.id), `the raw id is not shown: "${text}"`);
    expect.eq(
      await row.locator("[data-cy='customer-link-open']").getAttribute("href"),
      `/q/${quote.id}`,
      "Open as customer still links to the full /q/<id>",
    );
    expect.eq(
      await shown.getAttribute("title"),
      `/q/${quote.id}`,
      "the full link is on the hover title",
    );
  }));

Deno.test("REQ-571 (demo cycle 4, p4-p2c): /assistant after lock + send — ONE 'Open as customer' row for the quote, not one on the card and one under the divider", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { customer, quote } = await seedQuote(http, auth);
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
      customerId: customer.id,
    });
    // the lock appends the quote's action card; the send appends the divider
    await post(http, auth, `/api/agents/conversations/${conv.id}/lock-quote`, {
      quoteId: quote.id,
    });
    await post(http, auth, `/api/agents/conversations/${conv.id}/send-quote`, {
      quoteId: quote.id,
      channel: "email",
      language: "en",
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conv.id}`);
    await page.locator(".action-card").first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    const rows = page.locator("[data-cy='customer-link']");
    await rows.first().waitFor({ state: "visible", timeout: 20_000 });
    // the card's gate reads the fetched quote row: let it land
    await page.waitForTimeout(1_500);
    expect.eq(
      await rows.count(),
      1,
      "one customer-link row for the one quote",
    );
    expect.eq(
      await page.locator(
        `[data-cy='customer-link-open'][href='/q/${quote.id}']`,
      )
        .count(),
      1,
      "one 'Open as customer' link to /q/<id>",
    );
  }));
