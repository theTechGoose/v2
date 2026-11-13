/**
 * REQ-575 — demo-loop cycle 4, issue M3: "The assistant drops or misreads
 * details from the message" (client name, dates, duration, amount, phone).
 *
 * In a browser, the demo's own sentences:
 *   - pair 7's quick quote ending "Ponle precio, no sé, como 18 mil?" opened
 *     the price picker at $0.00 — it opens at 18,000;
 *   - pair 7's kitchen job named "the Hendersons" and "Carol Henderson", and
 *     "we start monday nov 23 … Dos semanas y media": the customer form said
 *     "Hendersons", the start card "Nov 16", the duration card "2 weeks" —
 *     they say Carol Henderson, Nov 23 and 2.5 weeks;
 *   - pair 9's "…cliente Juan Pérez" left the name empty, and pair 10's bad
 *     phone "555" was dropped without a word — the form has the name and
 *     says the typed phone is not a full number.
 *
 * No LLM turn: the chip → details → price picker is client-side, and the
 * wizard stories are seeded like REQ-265's (a quote carrying the typed text,
 * a conversation on it, transition-to-terms) — the same on the gate's fakes.
 *
 * Pages: /assistant (front-end/islands/AsstChat.tsx — submitJobDetails,
 * CustomerStepPanel, the wizard's prefill row); the readers in
 * shared/quote-flow/{money-amounts,quick-quote-prefill,quote-facts}.ts.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

/** a fresh number per sign-in: stories run in parallel */
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

/** Pair 7's Spanish quick quote (fleet-6 stdout:49/245). */
const PAIR7_Q2 =
  "Baño principal de la señora Tran en Round Rock, 512-555-0144: quitar la tina, regadera nueva con banca, piso radiante. " +
  "Dos semanas y media. Ponle precio, no sé, como 18 mil?";
/** Pair 7's kitchen job and her start-date message (fleet-6 stdout:223-225). */
const PAIR7_Q1 =
  "Kitchen gut for the Hendersons. Carol Henderson, 512-555-0188, Ridgewood Dr Austin. " +
  "we start monday nov 23. Dos semanas y media.";
/** Pair 9's message (fleet-8 stdout:179) with pair 10's bad phone. */
const PAIR9_10 =
  "Sacar muebles viejos de un garaje, 450 dólares, cliente Juan Pérez, teléfono 555";

/** A signed-in, onboarded, English account on the page's browser context;
 *  returns the request headers that act as that account. */
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
  await answerQuestions(http, auth, {
    name: "Fact Reader",
    businessName: "Fact Reader Remodeling",
  });
  const res = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  });
  await res.body?.cancel();
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

/** A quote whose description is the typed job, a conversation on it, and the
 *  terms wizard started — the page opens on the customer step. */
async function seedWizard(
  http: StoryTools["http"],
  auth: Record<string, string>,
  typed: string,
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
    summary: "Typed job",
    description: typed,
    lineItems: [{
      description: "Typed job",
      quantity: 1,
      unit: "ea",
      price: 3_800_000,
    }],
    estimatedTotal: 3_800_000,
  });
  const conv = await post("/api/agents/conversations", { quoteId: quote.id });
  await post(`/api/agents/conversations/${conv.id}/transition-to-terms`);
  return conv.id;
}

/** "Nov 23, <year>": this year's Nov 23, or next year's once it has passed. */
function nov23(): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let year = today.getFullYear();
  if (new Date(year, 10, 23) < today) year += 1;
  return `Nov 23, ${year}`;
}

/** Read an input until it holds `want` (the quote loads after the step). */
async function valueOf(
  page: StoryTools["page"],
  input: ReturnType<StoryTools["page"]["locator"]>,
  want: string,
): Promise<string> {
  let got = "";
  for (let i = 0; i < 40 && got !== want; i++) {
    got = await input.inputValue();
    if (got !== want) await page.waitForTimeout(250);
  }
  return got;
}

Deno.test("REQ-575 M3: pair 7's quick quote ending 'como 18 mil?' opens the price picker at 18,000, not $0.00", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/assistant");
    const chip = page.locator("button.chat__empty-prompt", {
      hasText: "Just give me a quick quote.",
    });
    await chip.waitFor({ state: "visible", timeout: 20_000 });
    // Click until the island has hydrated and opened the details composer.
    const composer = page.locator("textarea.composer__input");
    for (let i = 0; i < 20; i++) {
      await chip.click().catch(() => {});
      if (await page.locator(".chat__empty-prompts").count() === 0) break;
      await page.waitForTimeout(250);
    }
    await composer.waitFor({ state: "visible", timeout: 10_000 });
    await composer.fill(PAIR7_Q2);
    await page.locator("button.composer__send").click();

    const money = page.locator(".chat__price-capture input.mi__input");
    await money.waitFor({ state: "visible", timeout: 10_000 });
    expect.eq(
      (await money.inputValue()).trim(),
      "18,000",
      "the price picker opens at the typed 18 mil",
    );
  }));

Deno.test("REQ-575 M3: pair 7's kitchen job — the form says Carol Henderson, the start card Nov 23, the duration card 2.5 weeks", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const convId = await seedWizard(http, auth, PAIR7_Q1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${convId}`);

    const form = page.locator(".cust-create").first();
    await form.waitFor({ state: "visible", timeout: 20_000 });
    const nameInput = form.locator("input.cust-pick__search").first();
    expect.eq(
      await valueOf(page, nameInput, "Carol Henderson"),
      "Carol Henderson",
      "the full name, not the household 'Hendersons'",
    );
    await form.locator(".cust-create__btn--primary").click();

    await page.getByText(/when does the job start/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    const startPrefill = page.locator('[data-testid="wiz-prefill"]:visible');
    await startPrefill.waitFor({ state: "visible", timeout: 10_000 });
    const want = nov23();
    expect(
      (await startPrefill.innerText()).includes(want),
      `the typed "monday nov 23" is offered as ${want}, not the next Monday`,
    );
    await startPrefill.locator("button").click();

    await page.getByText(/how long will the job take/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    const durPrefill = page.locator('[data-testid="wiz-prefill"]:visible');
    await durPrefill.waitFor({ state: "visible", timeout: 10_000 });
    expect(
      /2\.5 weeks/.test(await durPrefill.innerText()),
      "'Dos semanas y media' is offered as 2.5 weeks, not 2",
    );
  }));

Deno.test("REQ-575 M3: 'cliente Juan Pérez, teléfono 555' — the name is filled and the form says the phone is not a full number", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const convId = await seedWizard(http, auth, PAIR9_10);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${convId}`);

    const form = page.locator(".cust-create").first();
    await form.waitFor({ state: "visible", timeout: 20_000 });
    const nameInput = form.locator("input.cust-pick__search").first();
    expect.eq(
      await valueOf(page, nameInput, "Juan Pérez"),
      "Juan Pérez",
      "the name after 'cliente' is in the name field",
    );
    const note = page.locator('[data-cy="cust-phone-unusable"]');
    await note.waitFor({ state: "visible", timeout: 10_000 });
    expect(
      (await note.innerText()).includes("555"),
      "the note names the typed phone",
    );
    expect.eq(
      (await form.locator("input[type=tel]").inputValue()).trim(),
      "",
      "the unusable phone is not put in the phone box",
    );
  }));
