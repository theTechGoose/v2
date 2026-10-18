/**
 * REQ-046 / REQ-047 — Raphael, 2026-09-30: "in the wizard we need to add TBD
 * to when does the job start and how long will the job take."
 *
 * The terms wizard's start-date step offers TBD before "Pick a date", and its
 * duration step offers TBD before "Custom". Picked, each lands on the
 * agreement as a bare "TBD" — the duration row is never "Estimated TBD".
 *
 * The conversation is seeded the way the assistant's own dev seed does it
 * (a sent quote → a conversation on it → transition-to-terms): no LLM turn,
 * so the story is the same on the gate's fakes and on a pin.
 *
 * Pages: /assistant/[id] (island front-end/islands/AsstChat.tsx; the steps in
 * backend/src/agents/domain/business/terms-wizard-spec/mod.ts) and the
 * agreement at /q/[id] (front-end/components/doc-parts.tsx, the TBD predicate
 * in shared/quote-flow/terms-i18n.ts).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const START_OPTIONS = [
  "Right away",
  "Next week",
  "Next month",
  "TBD",
  "Pick a date",
];
const DURATION_OPTIONS = [
  "1 day",
  "2–3 days",
  "1 week",
  "2 weeks",
  "Job completed",
  "TBD",
  "Custom",
];

/** A signed-in, onboarded, English account on the page's browser context;
 *  returns the request headers that act as that account. */
async function signIn(
  phone: string,
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
      ["/api/me", { name: "Wizard User", language: "en" }],
      ["/api/profile/identity", { businessName: "Wizard Business" }],
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
  // The cookie must be set for the host the runner actually serves on — the
  // gate uses 127.0.0.1, a pin uses localhost.
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

/** The dev seed's own sequence: a sent quote, a conversation on it, the
 *  hand-off to the terms wizard. Returns the conversation id. */
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
    summary: "Kitchen backsplash — 30 sqft",
    lineItems: [{
      description: "Backsplash tile install (30 sqft)",
      quantity: 1,
      unit: "ea",
      price: 120000,
    }],
    estimatedTotal: 120000,
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

/** Open the seeded conversation and get to the start-date question — through
 *  the customer step when the wizard asks for one first. */
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
    // The customer step: the create form on an empty account, else the pick
    // list with its "custom" option opening the form.
    if ((await page.locator(".cust-create").count()) === 0) {
      await page.locator(".wiz-opt--custom:visible").first().click();
    }
    await page.locator(".cust-create input.cust-pick__search").first().fill(
      "Start Date Customer",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125550928");
    await page.locator(".cust-create__btn--primary").click();
  }
  await startQuestion.first().waitFor({ state: "visible", timeout: 20_000 });
}

/** Payment and warranty steps: any answer; the terms land on the quote. */
async function finishWizard(page: StoryTools["page"]) {
  await page.getByText(/how would you like to be paid|payment/i).first()
    .waitFor({ state: "visible", timeout: 20_000 });
  await visibleOptions(page).first().click();
  await page.getByText(/warranty|stand behind your work/i).first().waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await visibleOptions(page).first().click();
}

/** The quote the conversation wrote its terms to, and its stored terms. */
async function storedTerms(
  http: StoryTools["http"],
  auth: Record<string, string>,
  conversationId: string,
): Promise<{ quoteId: string; byStep: Record<string, string> }> {
  const conv =
    await (await http(`/api/agents/conversations/${conversationId}`, {
      headers: auth,
    })).json();
  const quoteId: string = conv?.conversation?.quoteId ?? conv?.quoteId;
  const quote = await (await http(`/api/quotes/${quoteId}`, { headers: auth }))
    .json();
  const byStep: Record<string, string> = Object.fromEntries(
    (quote.terms ?? []).map((
      t: { stepId: string; value: string },
    ) => [t.stepId, t.value]),
  );
  return { quoteId, byStep };
}

async function agreementGrid(
  page: StoryTools["page"],
  quoteId: string,
): Promise<string> {
  await page.goto(`/q/${quoteId}?lang=en`);
  const grid = page.locator(".ctr__terms-grid");
  await grid.waitFor({ state: "visible", timeout: 20_000 });
  return (await grid.innerText()).replace(/\s+/g, " ");
}

Deno.test("REQ-046: TBD is offered on 'When does the job start?' and lands on the agreement as Start: TBD", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn("+15125550946", http, page, baseUrl);
    const conversationId = await seedWizard(http, auth);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAtStartDate(page, conversationId);
    const options = await optionTexts(page);
    expect.eq(
      options.join(" | "),
      START_OPTIONS.join(" | "),
      "TBD sits before 'Pick a date', which stays the last option",
    );
    await pick(page, /^\s*TBD\s*$/);
    // The transcript records the pick with the step's label…
    await expect.see("Start: TBD", { timeout: 20_000 });
    // …and the wizard moves on to the duration step.
    await expect.see("How long will the job take", { timeout: 20_000 });
    await visibleOptions(page).first().click();
    await finishWizard(page);
    const { quoteId, byStep } = await storedTerms(http, auth, conversationId);
    expect.eq(
      byStep.start_date,
      "TBD",
      "the stored start term is the bare value TBD",
    );
    const grid = await agreementGrid(page, quoteId);
    expect(
      /Start date\s*TBD/i.test(grid),
      `the agreement's start row reads TBD (${grid})`,
    );
  }));

Deno.test("REQ-047: TBD is offered on 'How long will the job take?' and lands on the agreement as Time to complete: TBD, never 'Estimated TBD'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn("+15125550936", http, page, baseUrl);
    const conversationId = await seedWizard(http, auth);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAtStartDate(page, conversationId);
    await pick(page, /^\s*TBD\s*$/);
    await expect.see("How long will the job take", { timeout: 20_000 });
    const options = await optionTexts(page);
    expect.eq(
      options.join(" | "),
      DURATION_OPTIONS.join(" | "),
      "TBD sits between 'Job completed' and 'Custom'",
    );
    await pick(page, /^\s*TBD\s*$/);
    await expect.see("Time to complete: TBD", { timeout: 20_000 });
    await finishWizard(page);
    const { quoteId, byStep } = await storedTerms(http, auth, conversationId);
    expect.eq(byStep.start_date, "TBD", "the stored start term is TBD");
    expect.eq(
      byStep.wraps,
      "TBD",
      "the stored duration term is the bare value TBD",
    );
    const grid = await agreementGrid(page, quoteId);
    expect(
      /Start date\s*TBD/i.test(grid),
      `the agreement's start row reads TBD (${grid})`,
    );
    expect(
      /Time to complete\s*TBD/i.test(grid),
      `the agreement's duration row reads TBD (${grid})`,
    );
    expect(
      !/Estimated TBD/i.test(grid),
      "the duration row is never 'Estimated TBD'",
    );
  }));
