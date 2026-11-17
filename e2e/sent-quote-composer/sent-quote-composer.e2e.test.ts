/**
 * REQ-244 — Raphael, 2026-11-11: "fix every issue the demo found."
 * Demo issue quote-invoice-money-m5: "No message box after signing, after
 * reopening a sent quote".
 *
 * The editable quote review auto-opens for every "Ready to send" CTA the
 * island has not seen reviewed, and an open review hides the message box.
 * The reviewed set lived only in memory, so any full page load after the
 * quote was sent (or signed) re-opened the review — Send active again — and
 * the composer was gone. The thread already records the send (a phase-3
 * divider) and the signature (a phase-4 divider); the island now rebuilds
 * "reviewed" from them.
 *
 * Seeded like wizard-tbd (a sent quote → a conversation → transition-to-
 * terms), the wizard answered in the browser, the quote sent and accepted
 * through the API, then the page reloaded.
 *
 * Page: /assistant/[id] (island front-end/islands/AsstChat.tsx; the rule in
 * front-end/lib/send-cta-settled.ts).
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
      ["/api/me", { name: "Composer User", language: "en" }],
      ["/api/profile/identity", { businessName: "Composer Business" }],
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

/** A sent quote, a conversation on it, the hand-off to the terms wizard. */
async function seedWizard(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<{ conversationId: string; quoteId: string }> {
  const quote = await post(http, auth, "/api/quotes", {
    summary: "Fence repair — 40 ft",
    lineItems: [{
      description: "Fence repair (40 ft)",
      quantity: 1,
      unit: "ea",
      price: 160000,
    }],
    estimatedTotal: 160000,
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
  return { conversationId: conv.id as string, quoteId: quote.id as string };
}

const visibleOptions = (page: StoryTools["page"]) =>
  page.locator(".wiz__opts .wiz-opt:visible");

/** an island may still be hydrating when its button appears: click until the
 *  page shows the effect (the house pattern, see global-search). */
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
      // detached or not clickable yet: the polls below say whether it landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

/** Answer every wizard step in the browser until the quote review opens:
 *  the customer step first (as wizard-tbd does), then the first plain option
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
      // the island may still be hydrating (SSR renders before the language
      // settles and the option re-renders): click until the form shows
      await clickUntil(
        page,
        ".wiz-opt--custom:visible",
        async () => (await page.locator(".cust-create:visible").count()) > 0,
      );
    }
    await page.locator(".cust-create input.cust-pick__search").first().fill(
      "Composer Customer",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125550931");
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
    // the step is answered once its option list is gone or replaced
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

const composer = (page: StoryTools["page"]) =>
  page.locator(".composer textarea.composer__input");

/** A full load of the thread, settled: the transcript is in (the last
 *  wizard answer shows) and the island has had time to run its auto-open
 *  effect — the composer is in the SSR markup before the thread loads, so
 *  checking it any earlier proves nothing. */
async function reopen(page: StoryTools["page"], conversationId: string) {
  await page.goto(`/assistant/${conversationId}`);
  await page.getByText(/Warranty:/).first().waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.waitForTimeout(2_000);
}

Deno.test("REQ-244: after a quote is sent, reloading the conversation shows the message box, not the review again", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const { conversationId, quoteId } = await seedWizard(http, auth);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conversationId}`);
    await finishWizardToReview(page);
    expect.eq(
      await page.locator(".quote-review:visible").count(),
      1,
      "the wizard ends on the editable review",
    );
    // The review is tap-only: no composer while it is open (by design).
    expect.eq(await composer(page).count(), 0, "review open hides composer");

    const sent = await post(
      http,
      auth,
      `/api/agents/conversations/${conversationId}/send-quote`,
      { quoteId, channel: "sms" },
    );
    expect(
      sent && !sent.statusCode,
      `send-quote answered (${JSON.stringify(sent).slice(0, 200)})`,
    );

    await reopen(page, conversationId);
    expect.eq(
      await composer(page).count(),
      1,
      "the message box is back after a reload",
    );
    expect.eq(
      await page.locator(".quote-review:visible").count(),
      0,
      "the editable review does not re-open over a sent quote",
    );
  }));

Deno.test("REQ-244: after the customer signs, reopening the conversation shows the message box", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const { conversationId, quoteId } = await seedWizard(http, auth);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conversationId}`);
    await finishWizardToReview(page);
    expect.eq(
      await page.locator(".quote-review:visible").count(),
      1,
      "the wizard ends on the editable review",
    );
    await post(
      http,
      auth,
      `/api/agents/conversations/${conversationId}/send-quote`,
      { quoteId, channel: "sms" },
    );
    await post(
      http,
      auth,
      `/api/agents/conversations/${conversationId}/accept-quote`,
      { quoteId },
    );

    await reopen(page, conversationId);
    expect.eq(
      await composer(page).count(),
      1,
      "the message box is back after signing",
    );
    expect.eq(
      await page.locator(".quote-review:visible").count(),
      0,
      "the editable review does not re-open over a signed quote",
    );
  }));
