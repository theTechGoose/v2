/**
 * REQ-245 — Raphael, 2026-11-11: "fix every issue the demo found."
 * Demo issue quote-invoice-money-m6: the chat header status was wrong or
 * stale — "Gathering a little more info" with the quote ready, "Quote sent"
 * on Lock, "New conversation" on a thread that had a quote.
 *
 * One thread, walked the way the demo did: a drafted quote (no customer,
 * no action_card — the price flow), Lock, the terms wizard answered in the
 * browser, then a Send that reaches nobody. After every step the header
 * (ChatHeaderLive, fed by AsstChat's pm:asst-header) must name the quote's
 * real state.
 *
 * Page: /assistant/[id] (islands AsstChat.tsx + ChatHeaderLive.tsx; the
 * rule in shared/quote-flow/chat-header.ts).
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
      ["/api/me", { name: "Header User", language: "en" }],
      ["/api/profile/identity", { businessName: "Header Business" }],
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

const title = (page: StoryTools["page"]) =>
  page.locator(".chat__head-title").first();
const status = (page: StoryTools["page"]) =>
  page.locator(".chat__head-sub").first();

/** Wait until the header's status line reads `want` (the island dispatches
 *  after the thread + quote load), then return title + status. */
async function headerOnceSettled(page: StoryTools["page"], want: RegExp) {
  await page.waitForFunction(
    (src) =>
      new RegExp(src, "i").test(
        (document.querySelector(".chat__head-sub") as HTMLElement | null)
          ?.innerText ?? "",
      ),
    want.source,
    { timeout: 20_000 },
  ).catch(() => {});
  return {
    title: (await title(page).innerText()).trim(),
    status: (await status(page).innerText()).trim(),
  };
}

/** Answer every wizard step in the browser until the quote review opens:
 *  the customer step first (a new customer with a phone, no email), then
 *  the first plain option of each remaining step. */
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
      "Header Customer",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125550932");
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

Deno.test("REQ-245: the chat header follows the quote — drafted, locked, gathering, ready to send, not delivered", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    // The price flow: a draft quote with a job name, a conversation on it,
    // no customer and no action_card.
    const quote = await post(http, auth, "/api/quotes", {
      summary: "Fence repair — 40 ft",
      jobName: "Fence repair",
      lineItems: [{
        description: "Fence repair (40 ft)",
        quantity: 1,
        unit: "ea",
        price: 160000,
      }],
      estimatedTotal: 160000,
      status: "draft",
    });
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
    });
    const url = `/assistant/${conv.id}`;

    await page.goto(url);
    let h = await headerOnceSettled(page, /quote drafted/i);
    expect(
      !/new conversation/i.test(h.title),
      `(c) a thread with a quote is never 'New conversation' (title: ${h.title})`,
    );
    expect.eq(h.title, "Fence repair", "(c) titled by the quote's job name");
    expect(/quote drafted/i.test(h.status), `drafted (status: ${h.status})`);

    // (b) Lock is not a send.
    await post(http, auth, `/api/agents/conversations/${conv.id}/lock-quote`, {
      quoteId: quote.id,
    });
    await page.goto(url);
    h = await headerOnceSettled(page, /quote locked/i);
    expect(
      /quote locked/i.test(h.status) &&
        !/quote sent|out for signature/i.test(h.status),
      `(b) after Lock: 'Quote locked', not sent (status: ${h.status})`,
    );

    // The wizard is asking.
    await post(
      http,
      auth,
      `/api/agents/conversations/${conv.id}/transition-to-terms`,
    );
    await page.goto(url);
    h = await headerOnceSettled(page, /gathering/i);
    expect(
      /gathering a little more info/i.test(h.status),
      `in the wizard: gathering (status: ${h.status})`,
    );

    // (a) The wizard finished and the draft is open → "Ready to send".
    await finishWizardToReview(page);
    h = await headerOnceSettled(page, /^ready to send$/i);
    expect(
      /^ready to send$/i.test(h.status),
      `(a) the draft review is open: 'Ready to send', not gathering (status: ${h.status})`,
    );

    // Send by email to a customer with no email → reached nobody.
    const sent = await post(
      http,
      auth,
      `/api/agents/conversations/${conv.id}/send-quote`,
      { quoteId: quote.id, channel: "email" },
    );
    expect(
      sent && !sent.statusCode,
      `send-quote answered (${JSON.stringify(sent).slice(0, 200)})`,
    );
    await page.goto(url);
    h = await headerOnceSettled(page, /not delivered/i);
    expect(
      /not delivered/i.test(h.status),
      `a send that reached nobody: 'Not delivered', not 'Out for signature' (status: ${h.status})`,
    );
    // REQ-327 (demo-loop cycle 1, p7): a failed delivery is not painted
    // green — the dot and the sub-line carry the --bad tone.
    const dotClass = await page.locator(".chat__head-dot").getAttribute(
      "class",
    );
    expect(
      /chat__head-dot--bad/.test(dotClass ?? ""),
      `REQ-327: 'Not delivered' gets a red dot, not the green one (class: ${dotClass})`,
    );
  }));
