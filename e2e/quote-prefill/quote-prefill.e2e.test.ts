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
    // REQ-495: the chip reads the date term in words ("Dec 1, 2026"); the
    // picker's MM/DD/YYYY is accepted too.
    const [mm, dd, yyyy] = start.split("/");
    const startWords = `Dec ${Number(dd)}, ${yyyy}`;
    const chip = await startPrefill.innerText();
    expect(
      mm === "12" && (chip.includes(start) || chip.includes(startWords)),
      `the start-date pre-selection shows ${start} / ${startWords} (got "${chip}")`,
    );
    await startPrefill.locator("button").click();
    await page.getByText(new RegExp(`${start}|${startWords}`)).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });

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
      // a date term is stored as MM/DD/YYYY or ISO (termDateIso reads both)
      [start, `${start.slice(6)}-${start.slice(0, 2)}-${start.slice(3, 5)}`]
        .some((v) => String(byStep.start_date?.value ?? "").includes(v)),
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

/** REQ-953 (LOOP-007 q1, q1-28; cites REQ-265): the QA tester's Spanish
 *  sentence ended "mitad al empezar y mitad al terminar" — a 50/50 schedule —
 *  and "¿Cuándo quieres recibir el pago?" showed no "De tu mensaje" confirm,
 *  only the spec's generic SUGGESTED 50/50. */
const TYPED_ES =
  "Cotización para Juan Pérez 512-555-0177, pintar 3 recámaras, mitad al empezar y mitad al terminar";

Deno.test("REQ-953: a Spanish 'mitad al empezar y mitad al terminar' is offered as the 50/50 'De tu mensaje' confirm on the payment step", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn("+15125550953", http, page, baseUrl);
    const put = await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "es" }),
    });
    await put.body?.cancel();
    const host = new URL(baseUrl).hostname;
    await page.context().addCookies([
      { name: "pm_lang", value: "es", domain: host, path: "/" },
    ]);
    const post = async (path: string, payload?: unknown) => {
      const res = await http(path, {
        method: "POST",
        headers: auth,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      return await res.json().catch(() => ({}));
    };
    const quote = await post("/api/quotes", {
      summary: "Pintar 3 recámaras",
      description: TYPED_ES,
      lineItems: [{
        description: "Pintar 3 recámaras",
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
    let typedName = "";
    for (let i = 0; i < 40 && typedName !== "Juan Pérez"; i++) {
      typedName = await nameInput.inputValue();
      if (typedName !== "Juan Pérez") await page.waitForTimeout(250);
    }
    expect.eq(typedName, "Juan Pérez", "the typed name is in the name field");
    await form.locator(".cust-create__btn--primary").click();

    // Start date and duration: not in the sentence — any answer.
    await page.getByText(/¿Cuándo empieza el trabajo\?/).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.locator(".wiz__opts .wiz-opt:visible").first().click();
    await page.getByText(/¿Cuánto tiempo tomará el trabajo\?/).first()
      .waitFor({ state: "visible", timeout: 20_000 });
    await page.locator(".wiz__opts .wiz-opt:visible").first().click();

    // Payment: the typed 50/50, one tap, "De tu mensaje".
    await page.getByText(/¿Cuándo quieres recibir el pago\?/).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    const payPrefill = page.locator('[data-testid="wiz-prefill"]:visible');
    let shown = 0;
    for (let i = 0; i < 20 && shown === 0; i++) {
      shown = await payPrefill.count();
      if (shown === 0) await page.waitForTimeout(250);
    }
    expect.eq(
      shown,
      1,
      "the payment step shows the 'De tu mensaje' pre-selection read from 'mitad al empezar y mitad al terminar'",
    );
    const text = await payPrefill.innerText();
    expect(/De tu mensaje/i.test(text), `the confirm says 'De tu mensaje' (${text})`);
    expect(/50\s*\/\s*50/.test(text), `the pre-selection is 50/50 (${text})`);
  }));
