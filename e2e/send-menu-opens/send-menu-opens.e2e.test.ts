/**
 * REQ-459 (demo-loop cycle 3, issue m44) — "Solo correo" in the ▾ send menu
 * does something.
 *
 * Demo pair 6: "Clicked Solo correo -> NOTHING happened (no dialog, no
 * request)". The menu item only pre-selected a channel and closed the menu,
 * and the main button reads a fixed "Send…" (REQ-402), so the pick left no
 * trace. Now a pick opens the "How do you want to send" dialog with that
 * channel already selected — still nothing is sent until the dialog's Send —
 * and after Cancel the main button names the pick ("Send by email…").
 *
 * Page: /assistant/[id] (island AsstChat.tsx; label rule in
 * front-end/lib/send-dialog.ts sendOpenLabelKey).
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
      ["/api/me", { name: "Menu User", language: "en" }],
      ["/api/profile/identity", { businessName: "Menu Business" }],
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
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
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

/** Answer every wizard step in the browser until the quote review opens:
 *  a new customer with a phone and no email, then the first plain option
 *  of each remaining step. */
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
      "Menu Customer",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125550944");
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

Deno.test("REQ-459 m44: picking 'Email only' in the ▾ send menu opens the send dialog on Email, sends nothing, and the main button then reads 'Send by email…'", (t) =>
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

    const sends: string[] = [];
    page.on("request", (r) => {
      if (/\/send-quote|\/send-invoice|\/send(\?|$)/.test(r.url())) {
        sends.push(r.url());
      }
    });

    await page.goto(`/assistant/${conv.id}`);
    await finishWizardToReview(page);

    const main = page.locator(".quote-review__send-main").first();
    await main.waitFor({ state: "visible", timeout: 20_000 });
    expect.eq(
      (await main.innerText()).trim(),
      "Send…",
      "REQ-402: before any pick the main button is the neutral 'Send…'",
    );

    await page.locator(".quote-review__send-caret").first().click();
    const emailItem = page.locator("[data-cy='send-menu-email']");
    await emailItem.waitFor({ state: "visible", timeout: 10_000 });
    await emailItem.click();

    const dialog = page.locator("[data-cy='send-dialog']");
    await dialog.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
    expect(
      await dialog.isVisible(),
      "picking 'Email only' opens the send dialog (it used to do nothing)",
    );
    expect.eq(
      await page.locator("[data-cy='send-option-email']").getAttribute(
        "aria-checked",
      ),
      "true",
      "the dialog opens with Email already selected",
    );
    expect.eq(
      await page.locator("[data-cy='send-add-email']").count(),
      1,
      "the customer has no email, so the dialog asks for one right away",
    );
    expect.eq(
      await page.locator(".quote-review__send-menu").count(),
      0,
      "the menu closed",
    );
    expect.eq(sends.length, 0, "a menu pick sends nothing on its own");

    await page.locator("[data-cy='send-cancel']").click();
    await dialog.waitFor({ state: "detached", timeout: 5_000 });
    expect.eq(
      (await main.innerText()).trim(),
      "Send by email…",
      "after a pick the main button names the picked channel",
    );
    expect.eq(sends.length, 0, "Cancel sends nothing");
  }));
