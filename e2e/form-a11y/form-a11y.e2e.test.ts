/**
 * REQ-289 — demo issue customers-payments-fieldops-p1 (demo-rca.md): the
 * signer's name field read as "Juan Pérez" to a screen reader (its label was
 * not tied to it), the assistant's new-customer phone and email had only a
 * placeholder, and the /customers "New customer" modal was a plain div/form.
 *
 * Every field below is found the way assistive tech finds it — by its
 * accessible name (getByLabel / getByRole name) — so a placeholder-only field
 * or an unlabelled overlay cannot pass.
 *
 * Pages: /q/[id] (islands PublicSignQuote + PublicQuoteActions),
 * /customers (island ClientsPage), /assistant/[id] (island AsstChat).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

/** A signed-in English account; with `browser`, its session is on the page too. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  browser: boolean,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
      ["/api/me", { name: "Label Story", language: "en" }],
      ["/api/profile/identity", { businessName: "Label Story LLC" }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
  if (browser) {
    const [name, value] = cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies([...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]));
  }
  return auth;
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  payload?: unknown,
) {
  const res = await http(path, {
    method: "POST",
    headers: auth,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return await res.json().catch(() => ({}));
}

/** an island may still be hydrating when its button appears: click until the effect shows */
async function clickUntil(
  page: StoryTools["page"],
  click: () => Promise<void>,
  done: () => Promise<boolean>,
) {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await click();
    } catch { /* not clickable yet */ }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error("the click never took");
}

Deno.test("REQ-289: the customer's name fields on /q are found by their labels — the sign field, the decline form, the ask form", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl, false);
    const customer = await post(http, auth, "/api/customers", {
      name: "Ana Label",
      phoneNumber: "+15125550289",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Fence repair",
      jobName: "Fence repair",
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "job",
        price: 50000,
      }],
      estimatedTotal: 50000,
      status: "sent",
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/q/${quote.id}`);

    const signName = page.getByLabel("Type your full legal name", {
      exact: true,
    });
    await signName.waitFor({ timeout: 15_000 });
    expect.eq(
      await signName.getAttribute("autocomplete"),
      "name",
      "the label names the sign pad's name field",
    );

    const optionalName = page.getByLabel("Your name (optional)", {
      exact: true,
    });
    await clickUntil(
      page,
      () =>
        page.getByRole("button", { name: "Decline" }).first().click({
          timeout: 2_000,
        }),
      async () => (await optionalName.count()) === 1,
    );
    expect(
      (await optionalName.count()) === 1,
      "the decline form's name field is found by its label",
    );
    // back to the action row (fresh page), then the ask form
    await page.reload();
    await signName.waitFor({ timeout: 15_000 });

    await clickUntil(
      page,
      () =>
        page.getByRole("button", { name: "Ask a question" }).first().click({
          timeout: 2_000,
        }),
      async () => (await optionalName.count()) === 1,
    );
    expect(
      (await optionalName.count()) === 1,
      "the ask form's name field is found by its label",
    );
  }));

Deno.test("REQ-289: /customers — New customer opens a modal dialog named by its heading, and Escape closes it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl, true);
    await page.goto("/customers");
    const dialog = page.getByRole("dialog", { name: "New customer" });
    const cta = page.locator("button.ph2__cta");
    await cta.waitFor({ timeout: 15_000 });
    await clickUntil(
      page,
      () => cta.click({ timeout: 2_000 }),
      async () => (await dialog.count()) === 1,
    );
    expect.eq(
      await dialog.getAttribute("aria-modal"),
      "true",
      "the dialog is modal",
    );
    expect(
      (await dialog.getByLabel("Name", { exact: true }).count()) === 1,
      "the name field is inside the dialog, labelled",
    );
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5_000 });
    expect((await dialog.count()) === 0, "Escape closed the dialog");
  }));

Deno.test("REQ-289: the assistant's new-customer form — phone and email are found by their names", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl, true);
    const quote = await post(http, auth, "/api/quotes", {
      summary: "Deck stain",
      lineItems: [{
        description: "Deck stain",
        quantity: 1,
        unit: "ea",
        price: 30000,
      }],
      estimatedTotal: 30000,
      status: "sent",
    });
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
    });
    await post(
      http,
      auth,
      `/api/agents/conversations/${conv.id}/transition-to-terms`,
    );
    await page.goto(`/assistant/${conv.id}`);
    // an empty account goes straight to the create form ("Who is this for?")
    await page.locator(".cust-create").first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    const tel = page.getByLabel("Phone Number", { exact: true });
    const email = page.getByLabel("Email (optional)", { exact: true });
    expect.eq(
      await tel.getAttribute("type"),
      "tel",
      "the phone field is found by its name",
    );
    expect.eq(
      await email.getAttribute("type"),
      "email",
      "the email field is found by its name",
    );
  }));
