/**
 * REQ-265 — demo issue ai-assistant-m1: "The assistant asks again for
 * details already typed. It asks for name, phone or email again, and doesn't
 * preselect the given start date or deposit."
 *
 * The RCA's own acceptance sentence — "Quote for Maria Lopez 512-555-0199,
 * start Dec 1, half deposit" — typed as the job, then the terms wizard:
 *   - the customer step opens the create form with the name, phone and email
 *     already filled, even though the account HAS customers (the demo got
 *     "Elige un cliente" — the pick list — instead);
 *   - "When does the job start?" offers the typed date as a one-tap confirm;
 *   - "How would you like to be paid?" offers 50/50 the same way;
 *   - confirmed, both land on the quote's terms.
 *
 * Seeded like the assistant's dev seed (REQ-046's story): the quote carries
 * the typed text as its description, a conversation on it, transition-to-
 * terms. No LLM turn, so the story is the same on the gate's fakes.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const TYPED =
  "Quote for Maria Lopez 512-555-0199 maria.lopez@example.com, paint 3 bedrooms, start Dec 1, half deposit";

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
      ["/api/me", { name: "Prefill User", language: "en" }],
      ["/api/profile/identity", { businessName: "Prefill Business" }],
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

/** The date the typed "Dec 1" means today: this year's, or next year's once
 *  it has passed — in the picker's MM/DD/YYYY. */
function expectedStart(): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let year = today.getFullYear();
  if (new Date(year, 11, 1) < today) year += 1;
  return `12/01/${year}`;
}

Deno.test("REQ-265: the wizard does not re-ask what the job sentence already said — customer filled, start date and 50/50 pre-selected", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn("+15125550965", http, page, baseUrl);
    const post = async (path: string, payload?: unknown) => {
      const res = await http(path, {
        method: "POST",
        headers: auth,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      return await res.json().catch(() => ({}));
    };
    // The account already has a customer — the demo's case: the step used to
    // open the pick list ("Elige un cliente") and drop the typed name.
    await post("/api/customers", {
      name: "Hans Weber",
      phoneNumber: "+15125550100",
    });
    const quote = await post("/api/quotes", {
      summary: "Paint 3 bedrooms",
      description: TYPED,
      lineItems: [{
        description: "Paint 3 bedrooms",
        quantity: 1,
        unit: "ea",
        price: 370000,
      }],
      estimatedTotal: 370000,
    });
    const conv = await post("/api/agents/conversations", {
      quoteId: quote.id,
    });
    await post(`/api/agents/conversations/${conv.id}/transition-to-terms`);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conv.id}`);

    // Customer step: the create form, filled from the sentence.
    const form = page.locator(".cust-create").first();
    await form.waitFor({ state: "visible", timeout: 20_000 });
    const nameInput = form.locator("input.cust-pick__search").first();
    // The quote (and so the sentence) loads after the step renders.
    let typedName = "";
    for (let i = 0; i < 40 && typedName !== "Maria Lopez"; i++) {
      typedName = await nameInput.inputValue();
      if (typedName !== "Maria Lopez") await page.waitForTimeout(250);
    }
    expect.eq(typedName, "Maria Lopez", "the typed name is in the name field");
    const phone = (await form.locator("input[type=tel]").inputValue())
      .replace(/\D/g, "");
    expect.eq(phone, "5125550199", "the typed phone is in the phone field");
    expect.eq(
      await form.locator("input[type=email]").inputValue(),
      "maria.lopez@example.com",
      "the typed email is in the email field",
    );
    await form.locator(".cust-create__btn--primary").click();

    // Start date: the typed date, one tap.
    await page.getByText(/when does the job start/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    const startPrefill = page.locator('[data-testid="wiz-prefill"]:visible');
    await startPrefill.waitFor({ state: "visible", timeout: 10_000 });
    const start = expectedStart();
    expect(
      (await startPrefill.innerText()).includes(start),
      `the start-date pre-selection shows ${start}`,
    );
    await startPrefill.locator("button").click();
    await expect.see(start, { timeout: 20_000 });

    // Duration: not in the sentence, so no pre-selection — any answer.
    await page.getByText(/how long will the job take/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    expect.eq(
      await page.locator('[data-testid="wiz-prefill"]:visible').count(),
      0,
      "a step the sentence said nothing about is not pre-selected",
    );
    await page.locator(".wiz__opts .wiz-opt:visible").first().click();

    // Payment: 50/50, one tap.
    await page.getByText(/how would you like to be paid|payment/i).first()
      .waitFor({ state: "visible", timeout: 20_000 });
    const payPrefill = page.locator('[data-testid="wiz-prefill"]:visible');
    await payPrefill.waitFor({ state: "visible", timeout: 10_000 });
    expect(
      /50\s*\/\s*50/.test(await payPrefill.innerText()),
      "the payment pre-selection is 50/50",
    );
    await payPrefill.locator("button").click();

    await page.getByText(/warranty|stand behind your work/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    // Warranty: not in the sentence — any answer finishes the wizard, which
    // writes the terms onto the quote.
    await page.locator(".wiz__opts .wiz-opt:visible").first().click();

    // Both landed on the quote's terms.
    let stored: {
      terms?: { stepId: string; value: string; optionId?: string }[];
    } = {};
    for (let i = 0; i < 40 && !(stored.terms ?? []).length; i++) {
      stored = await (await http(`/api/quotes/${quote.id}`, {
        headers: auth,
      })).json();
      if (!(stored.terms ?? []).length) await page.waitForTimeout(250);
    }
    const byStep: Record<string, { value: string; optionId?: string }> = Object
      .fromEntries(
        (stored.terms ?? []).map((
          t: { stepId: string; value: string; optionId?: string },
        ) => [t.stepId, t]),
      );
    expect(
      String(byStep.start_date?.value ?? "").includes(start),
      `start_date stored (${JSON.stringify(byStep.start_date)})`,
    );
    expect(
      /50/.test(String(byStep.payment_terms?.value ?? "")),
      `payment_terms stored as 50/50 (${JSON.stringify(byStep.payment_terms)})`,
    );
    const customers = await (await http("/api/customers", { headers: auth }))
      .json();
    expect(
      (customers as { name: string }[]).some((c) => c.name === "Maria Lopez"),
      "Maria Lopez was created from the prefilled form",
    );
  }));
