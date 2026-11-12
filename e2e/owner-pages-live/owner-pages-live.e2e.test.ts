/**
 * REQ-493 — demo-loop cycle 3, issue m7: "Open pages don't refresh after the
 * client acts". In a browser, with NO reload by the test and no focus,
 * visibility change or input in the owner's tab (the demo's headless tabs
 * fired none — pair 4: "tab 1 reports visibilityState=visible and
 * hasFocus=true"):
 *  - the assistant chat bound to a sent quote turns "Quote accepted" within
 *    4 s of the customer signing in person in another tab (pairs 1, 4, 7);
 *  - the open /quotes panel turns "Accepted" within 4 s of the same (pair 5);
 *  - /invoices moves an invoice the client claimed from their own phone to
 *    "Awaiting confirmation" on the topbar's next notifications tick, where
 *    the chip already moved (pair 9);
 *  - the owner's open /q page drops "Next: pay the $X due" once the deposit
 *    is confirmed paid (pair 9).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** an owner session over HTTP; the browser context gets its cookie */
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
      ["/api/me", { language: "en", name: "Rosa Live" }],
      ["/api/profile/identity", { businessName: "Rosa Fences" }],
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
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function send(
  http: StoryTools["http"],
  method: "POST" | "PUT",
  headers: Record<string, string>,
  path: string,
  payload?: unknown,
) {
  const r = await http(path, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
  }
  return json;
}

/** a customer and a quote sent to them */
async function sentQuote(
  http: StoryTools["http"],
  auth: Record<string, string>,
  jobName: string,
  opts: { conversation?: boolean } = {},
) {
  const customer = await send(http, "POST", auth, "/api/customers", {
    name: "Linda Moreno",
    email: "linda@blackhole.postmarkapp.com",
  });
  const quote = await send(http, "POST", auth, "/api/quotes", {
    customerId: customer.id,
    summary: jobName,
    jobName,
    lineItems: [{
      description: jobName,
      quantity: 1,
      unit: "job",
      price: 92500,
    }],
    estimatedTotal: 92500,
    terms: [{ stepId: "payment_terms", label: "Payment", value: "Due Now" }],
    status: "draft",
  });
  let convId: string | undefined;
  if (opts.conversation) {
    const conv = await send(http, "POST", auth, "/api/agents/conversations", {
      quoteId: quote.id,
    });
    convId = conv.id;
    await send(
      http,
      "POST",
      auth,
      `/api/agents/conversations/${conv.id}/lock-quote`,
      { quoteId: quote.id },
    );
  }
  await send(http, "PUT", auth, `/api/quotes/${quote.id}`, { status: "sent" });
  return { quoteId: quote.id as string, convId };
}

/** "Open as customer" in a new tab, the pad shown for the customer handed
 *  the owner's device (REQ-306/405), the name typed — ready to sign */
async function readyToSignInPerson(
  page: StoryTools["page"],
  baseUrl: string,
  quoteId: string,
) {
  const tab = await page.context().newPage();
  await tab.goto(new URL(`/q/${quoteId}?as=customer&confirm=1`, baseUrl).href);
  const form = tab.locator("form.ctr__sign-form");
  await form.waitFor({ timeout: 15_000 });
  await form.locator("input[type='text']").fill("Linda Moreno");
  return {
    tab,
    async sign() {
      const accepted = tab.waitForResponse(
        (r) => r.url().includes(`/api/quotes/${quoteId}/accept`),
        { timeout: 15_000 },
      );
      await tab.locator("form.ctr__sign-form button[type='submit']").click();
      const res = await accepted;
      if (!res.ok()) throw new Error(`accept → ${res.status()}`);
      return Date.now();
    },
  };
}

/** true once `fn` holds in the page, false when `ms` ran out */
function within(
  page: StoryTools["page"],
  ms: number,
  fn: string,
): Promise<boolean> {
  return page.waitForFunction(fn, undefined, { timeout: ms }).then(
    () => true,
    () => false,
  );
}

Deno.test("REQ-493 m7 (demo pairs 1, 4, 7): the assistant chat bound to a sent quote turns 'Quote accepted' within 4 s of the customer signing in person in another tab — no reload, no focus, no input in the chat's tab", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const { quoteId, convId } = await sentQuote(http, auth, "Re-roofing", {
      conversation: true,
    });

    await page.goto(`/assistant/${convId}`);
    const head = () =>
      page.locator(".chat__head-sub").first().textContent().then((s) =>
        (s ?? "").trim()
      );
    expect(
      await within(
        page,
        25_000,
        `/out for signature/i.test(document.querySelector(".chat__head-sub")?.textContent ?? "")`,
      ),
      `the chat opens on the sent quote (header: ${await head()})`,
    );
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__req493 = "same page";
    });

    const customer = await readyToSignInPerson(page, baseUrl, quoteId);
    // Sign right after the conversation list's poll answered in the chat's
    // tab: its next poll — and REQ-369's hand-back — is then ≥ 8 s away.
    await page.waitForResponse(
      (r) => r.url().includes("/api/agents/conversations?"),
      { timeout: 30_000 },
    );
    const signedAt = await customer.sign();

    const followed = await within(
      page,
      4_000,
      `/quote accepted/i.test(document.querySelector(".chat__head-sub")?.textContent ?? "")`,
    );
    expect(
      followed,
      `the chat header follows the signature within 4 s (header: "${await head()}", ${
        Date.now() - signedAt
      } ms after it)`,
    );
    const chips = page.locator(".action-card__chip");
    const card = (await chips.nth((await chips.count()) - 1).textContent())
      ?.trim() ?? "";
    expect.eq(card, await head(), "the quote card reads the header");
    expect.eq(
      await page.evaluate(() =>
        (globalThis as Record<string, unknown>).__req493
      ),
      "same page",
      "no reload",
    );
    await customer.tab.close();
  }));

Deno.test("REQ-493 m7 (demo pair 5): the open /quotes panel turns Accepted within 4 s of the customer signing in person in another tab — no reload, no focus", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quoteId } = await sentQuote(http, auth, "Porch rebuild");

    await page.goto(`/quotes?open=${quoteId}`);
    const badge = page.locator("[data-cy='quote-status-badge']");
    await badge.waitFor({ timeout: 15_000 });
    expect(
      !/accepted/i.test(await badge.innerText()),
      `the panel opens unsigned (${await badge.innerText()})`,
    );
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__req493 = "same page";
    });

    const customer = await readyToSignInPerson(page, baseUrl, quoteId);
    const signedAt = await customer.sign();

    const followed = await badge.filter({ hasText: /accepted/i }).waitFor({
      timeout: 4_000,
    }).then(() => true, () => false);
    expect(
      followed,
      `the open panel follows the signature within 4 s (badge: "${await badge
        .innerText()}", ${Date.now() - signedAt} ms after it)`,
    );
    expect.eq(
      await page.evaluate(() =>
        (globalThis as Record<string, unknown>).__req493
      ),
      "same page",
      "no reload",
    );
    await customer.tab.close();
  }));

Deno.test("REQ-493 m7 (demo pair 9): /invoices moves an invoice the client claims from their own phone to 'Awaiting confirmation' on the topbar's next notifications tick — no reload, no focus", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await send(http, "POST", auth, "/api/customers", {
      name: "Maria Lopez",
      email: "maria@blackhole.postmarkapp.com",
    });
    const today = new Date();
    const due = new Date(today.getTime() + 7 * 86_400_000);
    const inv = await send(http, "POST", auth, "/api/invoices", {
      customerId: customer.id,
      jobName: "Deck stain",
      lineItems: [{
        description: "Deck stain",
        quantity: 1,
        unit: "job",
        price: 45000,
      }],
      amount: 45000,
      status: "sent",
      issuedDate: today.toISOString().slice(0, 10),
      dueDate: due.toISOString().slice(0, 10),
    });

    await page.goto("/invoices");
    await page.locator("[data-cy='invoice-card-job']", {
      hasText: "Deck stain",
    }).first().waitFor({ timeout: 15_000 });
    const awaiting = page.locator(
      "[data-cy='awaiting-confirmation-track'] [data-cy='invoice-card-job']",
      { hasText: "Deck stain" },
    );
    expect.eq(await awaiting.count(), 0, "nothing awaits confirmation yet");
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__req493 = "same page";
    });

    // the client, on their own phone: "I paid by Zelle"
    const claim = await http(`/api/invoices/${inv.id}/claim-payment`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ method: "zelle", reference: "ZL-493" }),
    });
    expect.eq(claim.status, 200, "the public claim is accepted");
    await claim.body?.cancel();
    const claimedAt = Date.now();

    const followed = await awaiting.first().waitFor({ timeout: 25_000 }).then(
      () => true,
      () => false,
    );
    expect(
      followed,
      `the list follows the claim on the topbar's next tick (${
        Date.now() - claimedAt
      } ms after it)`,
    );
    expect.eq(
      await page.evaluate(() =>
        (globalThis as Record<string, unknown>).__req493
      ),
      "same page",
      "no reload",
    );
  }));

Deno.test("REQ-493 m7 (demo pair 9): the owner's open /q page drops 'Next: pay the $X due' once the deposit is confirmed paid — no reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quoteId } = await sentQuote(http, auth, "Cedar fence");
    // the customer signed on their own phone; the signature billed the deposit
    await send(http, "POST", JSON_HEADERS, `/api/quotes/${quoteId}/accept`, {
      name: "Linda Moreno",
      signature: "data:image/png;base64,iVBORw0KGgo=",
    });
    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json() as { id: string; quoteId?: string }[];
    const deposit = invoices.find((i) => i.quoteId === quoteId);
    expect(!!deposit, "the signature billed the deposit");

    await page.goto(`/q/${quoteId}`);
    await page.locator("[data-cy='quote-signed-banner-pay']").waitFor({
      timeout: 15_000,
    });
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__req493 = "same page";
    });

    // the client claims it, the owner confirms it in another tab
    await send(
      http,
      "POST",
      JSON_HEADERS,
      `/api/invoices/${deposit!.id}/claim-payment`,
      { method: "zelle" },
    );
    await send(
      http,
      "POST",
      auth,
      `/api/invoices/${deposit!.id}/confirm-payment`,
    );
    const paidAt = Date.now();

    const followed = await within(
      page,
      25_000,
      `document.querySelectorAll("[data-cy='quote-signed-banner-pay']").length === 0 && /\\$0\\.00/.test(document.querySelector("[data-cy='related-doc-invoice']")?.textContent ?? "")`,
    );
    const banner = (await page.locator("[data-cy='quote-signed-banner']")
      .innerText()).replace(/\s+/g, " ");
    expect(
      followed,
      `the signed banner and the related invoice follow the payment (${
        Date.now() - paidAt
      } ms after it; banner: "${banner}")`,
    );
    expect.eq(
      await page.evaluate(() =>
        (globalThis as Record<string, unknown>).__req493
      ),
      "same page",
      "no reload",
    );
  }));
