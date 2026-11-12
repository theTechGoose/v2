/**
 * REQ-570 (demo-loop cycle 4, issue m41) — "No Preview in the Send ▾ menu,
 * and no Send on the Quotes drawer" (pair 7).
 *
 *  1. /quotes?open=<id> on a sent quote: the panel has a Send ▾ whose menu
 *     lists Text + Email / Text only / Email only and "Preview as customer"
 *     (→ /q/<id>). Email only opens the send dialog on Email; its Send goes
 *     out through POST /agents/conversations/:id/send-quote and the panel
 *     says who it reached.
 *  2. /assistant/<id>: the quote review's Send ▾ menu has "Preview as
 *     customer", a link to /q/<id> in a new tab.
 *
 * Pages: /quotes (QuotesPage.tsx + components/QuoteSendDialog.tsx),
 * /assistant/[id] (AsstChat.tsx).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Panel User", language: "en" }],
      ["/api/profile/identity", { businessName: "Panel Business" }],
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

/** an island may still be hydrating when its target appears: click until the effect shows */
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

/** Answer every wizard step until the quote review opens. */
async function finishWizardToReview(page: StoryTools["page"]) {
  const review = page.locator(".quote-review");
  const startQuestion = page.getByText(/when does the job start/i);
  await page.locator(".wiz__opts, .cust-create").first().waitFor({
    state: "visible",
    timeout: 20_000,
  });
  if ((await startQuestion.count()) === 0) {
    if ((await page.locator(".cust-create").count()) === 0) {
      await page.locator(".wiz-opt--custom:visible").first().click();
    }
    await page.locator(".cust-create input.cust-pick__search").first().fill(
      "Preview Customer",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125550945");
    await page.locator(".cust-create__btn--primary").click();
  }
  const plain = page.locator(
    ".wiz__opts .wiz-opt:not(.wiz-opt--custom):visible",
  );
  for (let i = 0; i < 10; i++) {
    await page.locator(".quote-review, .wiz__opts .wiz-opt:visible").first()
      .waitFor({ state: "visible", timeout: 20_000 });
    if (await review.first().isVisible().catch(() => false)) return;
    const label = (await plain.first().innerText()).trim();
    await plain.first().click();
    await page.waitForFunction(
      (l) =>
        ![...document.querySelectorAll(".wiz__opts .wiz-opt")].some((e) =>
          (e as HTMLElement).offsetParent !== null &&
          (e as HTMLElement).innerText.trim() === l
        ),
      label,
      { timeout: 20_000 },
    ).catch(() => {});
  }
  await review.first().waitFor({ state: "visible", timeout: 20_000 });
}

Deno.test("REQ-570 m41: the /quotes panel has Send ▾ (three channels + Preview as customer) and its Email send goes out through send-quote", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const customer = await post(http, auth, "/api/customers", {
      name: "Pia Panel",
      email: "pia@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Porch repair — Pia Panel",
      jobName: "Porch repair",
      lineItems: [{
        description: "Porch repair",
        quantity: 1,
        unit: "job",
        price: 64000,
      }],
      estimatedTotal: 64000,
      status: "draft",
    });
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        status: "sent",
        sentAt: new Date().toISOString(),
      }),
    });
    await sent.body?.cancel();

    const sends: string[] = [];
    page.on("request", (r) => {
      if (/\/send-quote/.test(r.url())) sends.push(r.url());
    });

    await page.goto(`/quotes?open=${quote.id}`);
    const panel = page.locator("[data-cy='quote-open-panel']");
    await panel.waitFor({ timeout: 15_000 });
    const sendBtn = page.locator("[data-cy='quote-panel-send']");
    await sendBtn.waitFor({ state: "visible", timeout: 15_000 }).catch(
      () => {},
    );
    expect.eq(await sendBtn.count(), 1, "the quote panel has a Send ▾ button");

    const menu = page.locator("[data-cy='quote-panel-send-menu']");
    await clickUntil(
      page,
      "[data-cy='quote-panel-send']",
      async () => (await menu.count()) > 0,
    );
    for (const ch of ["both", "sms", "email"]) {
      expect.eq(
        await page.locator(`[data-cy='quote-panel-send-${ch}']`).count(),
        1,
        `the Send menu offers the ${ch} channel`,
      );
    }
    const preview = page.locator("[data-cy='quote-panel-send-preview']");
    expect.eq(
      await preview.count(),
      1,
      "the Send menu offers Preview as customer",
    );
    expect.eq(
      await preview.getAttribute("href"),
      `/q/${quote.id}`,
      "Preview as customer opens the customer's page",
    );
    expect.eq(
      (await preview.innerText()).trim(),
      "Preview as customer",
      "the item reads 'Preview as customer'",
    );
    expect.eq(sends.length, 0, "opening the menu sends nothing");

    await page.locator("[data-cy='quote-panel-send-email']").click();
    const dialog = page.locator("[data-cy='send-dialog']");
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
    expect.eq(
      await page.locator("[data-cy='send-option-email']").getAttribute(
        "aria-checked",
      ),
      "true",
      "the dialog opens on the picked channel",
    );
    expect.eq(sends.length, 0, "a menu pick alone sends nothing");

    await page.locator("[data-cy='send-keep']").click();
    const result = page.locator("[data-cy='quote-panel-send-result']");
    await result.waitFor({ state: "visible", timeout: 20_000 });
    await expect.see("pia@blackhole.postmarkapp.com");
    expect.eq(sends.length, 1, "Send went out once through send-quote");
    expect.eq(await dialog.count(), 0, "the dialog closed after the send");
  }));

Deno.test("REQ-570 m41: the assistant's Send ▾ menu has 'Preview as customer' linking to /q/<id>", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const quote = await post(http, auth, "/api/quotes", {
      summary: "Gate repair",
      jobName: "Gate repair",
      lineItems: [{
        description: "Gate repair",
        quantity: 1,
        unit: "ea",
        price: 45000,
      }],
      estimatedTotal: 45000,
      status: "draft",
    });
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
    });
    await post(http, auth, `/api/agents/conversations/${conv.id}/lock-quote`, {
      quoteId: quote.id,
    });
    await post(
      http,
      auth,
      `/api/agents/conversations/${conv.id}/transition-to-terms`,
    );

    await page.goto(`/assistant/${conv.id}`);
    await finishWizardToReview(page);
    await page.locator(".quote-review__send-caret").first().click();
    const preview = page.locator("[data-cy='send-menu-preview']");
    await preview.waitFor({ state: "visible", timeout: 10_000 });
    expect.eq(
      (await preview.innerText()).trim(),
      "Preview as customer",
      "the Send ▾ menu has 'Preview as customer'",
    );
    expect.eq(
      await preview.getAttribute("href"),
      `/q/${quote.id}`,
      "it opens the customer's page for this quote",
    );
    expect.eq(
      await preview.getAttribute("target"),
      "_blank",
      "in a new tab, so the review stays put",
    );
  }));
