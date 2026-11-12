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
