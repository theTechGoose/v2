/**
 * REQ-343 — Raphael, 2026-11-11: "fix every issue the demo found, loop until
 * there are none." Demo-loop cycle 1, issues p3 ("Examples and questions
 * don't fit the trade: slab placeholder, warranty for cleaning") and p6
 * ("Odd duration choices: 'Job completed' for a future job, no hours").
 *
 * A cleaning business sees a cleaning example in the composer (never the
 * concrete slab), gets hours presets on "How long will the job take?" with no
 * "Job completed", and is never asked about a warranty. A painter sees a
 * painting example.
 *
 * The wizard is seeded the way wizard-tbd does it (a sent quote → a
 * conversation → transition-to-terms): no LLM turn.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };

async function signIn(
  phone: string,
  businessName: string,
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
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
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Trade User", language: "en" }],
      ["/api/profile/identity", { businessName }],
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

async function seedWizard(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<string> {
  const post = async (path: string, payload?: unknown) => {
    const res = await http(path, {
      method: "POST",
      headers: auth,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return await res.json().catch(() => ({}));
  };
  const quote = await post("/api/quotes", {
    summary: "Deep clean — 3 bed, 2 bath",
    lineItems: [{
      description: "Deep clean (3 bed, 2 bath)",
      quantity: 1,
      unit: "ea",
      price: 32000,
    }],
    estimatedTotal: 32000,
    status: "sent",
  });
  const conv = await post("/api/agents/conversations", { quoteId: quote.id });
  await post(`/api/agents/conversations/${conv.id}/transition-to-terms`);
  return conv.id as string;
}

const visibleOptions = (page: StoryTools["page"]) =>
  page.locator(".wiz__opts .wiz-opt:visible");
async function optionTexts(page: StoryTools["page"]): Promise<string[]> {
  return (await visibleOptions(page).allTextContents())
    .map((s) => s.replace(/\s+/g, " ").trim());
}
const pick = (page: StoryTools["page"], text: RegExp) =>
  visibleOptions(page).filter({ hasText: text }).first().click();

async function openAtStartDate(
  page: StoryTools["page"],
  conversationId: string,
) {
  await page.goto(`/assistant/${conversationId}`);
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
      "Trade Fit Customer",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125553430");
    await page.locator(".cust-create__btn--primary").click();
  }
  await startQuestion.first().waitFor({ state: "visible", timeout: 20_000 });
}

async function composerPlaceholder(page: StoryTools["page"]): Promise<string> {
  await page.goto("/assistant");
  const box = page.locator("textarea[placeholder]").first();
  await box.waitFor({ state: "visible", timeout: 20_000 });
  return (await box.getAttribute("placeholder")) ?? "";
}

Deno.test("REQ-343 p3/p6: a cleaning business gets a cleaning example, hours presets, no 'Job completed' and no warranty question", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(
      "+15125553431",
      "Sparkle Home Cleaning",
      http,
      page,
      baseUrl,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    const placeholder = await composerPlaceholder(page);
    expect(!/slab/i.test(placeholder), `no slab example (${placeholder})`);
    expect(/clean/i.test(placeholder), `a cleaning example (${placeholder})`);

    const conversationId = await seedWizard(http, auth);
    await openAtStartDate(page, conversationId);
    await pick(page, /^\s*Right away\s*$/);
    await expect.see("How long will the job take", { timeout: 20_000 });
    const options = await optionTexts(page);
    expect.eq(
      options.join(" | "),
      ["2 hours", "4 hours", "Half a day", "1 day", "2–3 days", "TBD", "Custom"]
        .join(" | "),
      "a service trade's duration step leads with hours and has no 'Job completed'",
    );
    await pick(page, /^\s*4 hours\s*$/);
    await page.getByText(/how would you like to be paid|payment/i).first()
      .waitFor({ state: "visible", timeout: 20_000 });
    await visibleOptions(page).first().click();
    // The wizard ends after payment terms: no warranty question.
    await page.waitForTimeout(1500);
    expect.eq(
      await page.getByText(/stand behind your work/i).count(),
      0,
      "a cleaner is never asked about a warranty",
    );
  }));

Deno.test("REQ-343 p3: a painter's composer shows a painting example, not the slab", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn("+15125553432", "Jim Paints", http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const placeholder = await composerPlaceholder(page);
    expect(!/slab/i.test(placeholder), `no slab example (${placeholder})`);
    expect(/paint/i.test(placeholder), `a painting example (${placeholder})`);
  }));

/**
 * REQ-450 — demo-loop cycle 3, issue p4 ("Placeholder examples don't fit the
 * flow or the trade"). Tap a starter chip, read the composer's example: "I
 * know my price" shows a priced job of the business's trade and never asks
 * what to charge; "help me price it" asks. A fencing business — one of the
 * trades that used to fall back to the slab — sees a fence.
 */
async function placeholderAfterChip(
  page: StoryTools["page"],
  chipText: string,
): Promise<string> {
  await page.goto("/assistant");
  const chip = page.locator("button.chat__empty-prompt", { hasText: chipText });
  await chip.waitFor({ state: "visible", timeout: 20_000 });
  // Click until the island has hydrated and opened the details composer.
  for (let i = 0; i < 20; i++) {
    await chip.click().catch(() => {});
    if (await page.locator(".chat__empty-prompts").count() === 0) break;
    await page.waitForTimeout(250);
  }
  const box = page.locator("textarea.composer__input").first();
  await box.waitFor({ state: "visible", timeout: 10_000 });
  return (await box.getAttribute("placeholder")) ?? "";
}

Deno.test("REQ-450 p4: 'I know my price' shows a priced example of the trade; 'help me price it' asks what to charge", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn("+15125553433", "Lone Star Fence Co.", http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const priced = await placeholderAfterChip(
      page,
      "I know my price, write it up.",
    );
    expect(/fence/i.test(priced), `a fencing example (${priced})`);
    expect(/\$\d/.test(priced), `the example names a price (${priced})`);
    expect(
      !/what should I charge/i.test(priced),
      `the known-price example does not ask what to charge (${priced})`,
    );
    const ask = await placeholderAfterChip(
      page,
      "I know the job, help me price it.",
    );
    expect(/fence/i.test(ask), `a fencing example (${ask})`);
    expect(
      /what should I charge/i.test(ask),
      `help-me-price asks what to charge (${ask})`,
    );
  }));

/**
 * REQ-581 — demo-loop cycle 4 (run r857a9d67), issue p3: "Examples don't fit
 * the trade ('tile $3,600' for fence company)". A fencing business taps Edit
 * on a draft quote card: the hint under the composer gives a fence change,
 * not the tile one. The conversation load is answered by page.route, so no
 * LLM is involved.
 */
Deno.test("REQ-581 c4 p3: a fencing business's Edit hint gives a fence change, not 'tile $3,600'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(
      "+15125553435",
      "Lone Star Fence Co.",
      http,
      page,
      baseUrl,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    const res = await http("/api/agents/conversations", {
      method: "POST",
      headers: auth,
      body: "{}",
    });
    const conversation = await res.json();
    const id = conversation.id as string;
    const now = Date.now();
    await page.route(
      `**/api/agents/conversations/${id}`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            conversation,
            messages: [
              {
                id: "m-user",
                conversationId: id,
                role: "user",
                kind: "text",
                content: "150 ft cedar privacy fence, $6,750",
                createdAt: now - 2000,
              },
              {
                id: "m-card",
                conversationId: id,
                role: "assistant",
                kind: "action_card",
                content: "Quote drafted",
                createdAt: now - 1000,
                payload: {
                  actionType: "quote",
                  status: "draft",
                  quoteId: "q-req581",
                  lineItems: [
                    { description: "Cedar privacy fence", amountCents: 600000 },
                    { description: "Gate", amountCents: 75000 },
                  ],
                  totalCents: 675000,
                },
              },
            ],
          }),
        }),
    );
    await page.goto(`/assistant?c=${id}`);
    const draftCard = page.locator(".action-card", {
      hasText: "Cedar privacy fence",
    });
    await draftCard.waitFor({ state: "visible", timeout: 20_000 });
    const composer = page.locator("textarea.composer__input");
    await composer.waitFor({ state: "visible" });
    await composer.fill("");
    const edit = draftCard.locator("button.action-card__btn", {
      hasText: "Edit",
    });
    // Click until the island has hydrated and seeded the composer.
    for (let i = 0; i < 20; i++) {
      await edit.click().catch(() => {});
      if ((await composer.inputValue()) === "Change the quote: ") break;
      await page.waitForTimeout(250);
    }
    const hint = page.locator(".composer__hint", {
      hasText: "Type the change",
    });
    await hint.waitFor({ state: "visible", timeout: 5000 });
    const text = (await hint.first().textContent()) ?? "";
    expect(!/tile/i.test(text), `no tile example for a fencer (${text})`);
    expect(/fence|gate|post/i.test(text), `a fencing change (${text})`);
  }));
