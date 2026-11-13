/**
 * REQ-699 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5, issue M20: "No monthly/recurring billing in the
 * quote flow; Subscriptions not linked to quotes". Pair 2 typed "Cotización
 * para María López, 305-555-0144, corte de césped y poda de setos, 4 visitas
 * al mes, $180 al mes"; the payment step had no monthly option ("¿y cobro
 * MENSUAL? No hay opción de mensual", fleet-1 stdout:406), the signature
 * billed a one-time $180 (INV-001) and Campo → Suscripciones said "0 ACTIVAS"
 * (fleet-1 stdout:433).
 *
 * In a browser, seeded like REQ-265's story (the quote carries the typed
 * sentence, a conversation on it, transition-to-terms; no LLM turn, so the
 * story is the same on the gate's fakes):
 *   1. pair 2, in Spanish: the payment step asks "Dijiste $180 al mes. ¿Lo
 *      cobras una sola vez o cada mes?" with the one-off options still
 *      offered; one tap ("Cobrarlo cada mes") stores "Monthly · $180/mo"; the
 *      agreement on /q reads "Mensual · $180/mes", billed every month;
 *      signed on the public accept, it bills no one-off invoice, Campo →
 *      Suscripciones shows "De Q-00x · Mensual · $180/mes", and the owner's
 *      thread says it is billed from there;
 *   2. no price per period in the sentence, in English: the contractor picks
 *      Recurring from the options, chooses every 2 weeks, $90 and a last day
 *      in its form, and the quote stores "Every 2 weeks · $90/2 wks · until
 *      2027-06-30".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** Pair 2's job sentence, verbatim (fleet-1 stdout:395). */
const PAIR2 =
  "Cotización para María López, 305-555-0144, corte de césped y poda de setos, 4 visitas al mes, $180 al mes";

type Lang = "en" | "es";

const QUESTIONS: Record<Lang, Record<string, RegExp>> = {
  es: {
    start: /¿Cuándo empieza el trabajo\?/,
    wraps: /¿Cuánto tiempo tomará el trabajo\?/,
    payment: /¿Cuándo quieres recibir el pago\?/,
    warranty: /¿Por cuánto tiempo respaldas tu trabajo\?/,
  },
  en: {
    start: /When does the job start\?/,
    wraps: /How long will the job take\?/,
    payment: /When do you want to get paid\?/,
    warranty: /How long do you stand behind your work\?/,
  },
};

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: Lang,
) {
  const phone = `+1512${digits()}`;
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Jorge Ramirez", language: lang }],
      ["/api/profile/identity", { businessName: "Jardines Ramirez" }],
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
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
  return { auth };
}

/** Click until the page shows the effect — an island's button can be on the
 *  page before it hydrates (the house helper, e2e/signed-next-step). Only for
 *  the page's first click: a step that waits on the server is one click and a
 *  long wait (`see`), so a slow answer is never clicked twice. */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
  folder: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet (hydrating) or gone: the polls below decide
    }
    for (let i = 0; i < 25; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  await page.screenshot({ path: `${folder}/never-took.png` }).catch(() => {});
  throw new Error(`${selector}: the click never took`);
}

/** Wait for visible text; a timeout leaves a screenshot of what was there. */
async function see(
  page: StoryTools["page"],
  text: RegExp,
  folder: string,
  timeout = 90_000,
): Promise<void> {
  try {
    await page.getByText(text).filter({ visible: true }).first().waitFor({
      state: "visible",
      timeout,
    });
  } catch (err) {
    await page.screenshot({ path: `${folder}/not-seen.png` }).catch(() => {});
    throw err;
  }
}

const visible = async (page: StoryTools["page"], text: RegExp) =>
  (await page.getByText(text).filter({ visible: true }).count()) > 0;

/** A quote that carries the typed sentence, a conversation on it, and the
 *  terms wizard opened on its /assistant thread. */
async function openWizard(
  { http, page }: Pick<StoryTools, "http" | "page">,
  auth: Record<string, string>,
  job: { sentence: string; jobName: string; cents: number },
) {
  const post = async (path: string, payload?: unknown) => {
    const res = await http(path, {
      method: "POST",
      headers: auth,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`POST ${path} → ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  };
  const quote = await post("/api/quotes", {
    summary: job.jobName,
    jobName: job.jobName,
    description: job.sentence,
    serviceAddress: "845 Palm Ave, Orlando, FL 32803",
    lineItems: [{
      description: job.jobName,
      quantity: 1,
      unit: "job",
      price: job.cents,
    }],
    estimatedTotal: job.cents,
  });
  const conv = await post("/api/agents/conversations", { quoteId: quote.id });
  await post(`/api/agents/conversations/${conv.id}/transition-to-terms`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/assistant/${conv.id}`);
  return { quote, conv };
}

/** The customer step (its create form, filled from the sentence), then any
 *  start and duration, up to the payment question. */
async function answerUntilPayment(
  page: StoryTools["page"],
  lang: Lang,
  customer: string,
  folder: string,
): Promise<string> {
  const form = page.locator(".cust-create").first();
  await form.waitFor({ state: "visible", timeout: 60_000 });
  const nameInput = form.locator("input.cust-pick__search").first();
  let typedName = "";
  for (let i = 0; i < 40 && typedName !== customer; i++) {
    typedName = await nameInput.inputValue();
    if (typedName !== customer) await page.waitForTimeout(250);
  }
  const q = QUESTIONS[lang];
  await clickUntil(
    page,
    ".cust-create .cust-create__btn--primary",
    () => visible(page, q.start),
    folder,
  );
  // Hydrated now: one click per step, then its next question.
  for (const next of [q.wraps, q.payment]) {
    await page.locator(".wiz__opts .wiz-opt:visible").first().click({
      timeout: 60_000,
    });
    await see(page, next, folder);
  }
  return typedName;
}

/** A service trade's wizard (lawn care) ends at payment; a project trade's
 *  still asks for the warranty — any answer finishes it. */
async function finishWizard(page: StoryTools["page"], lang: Lang) {
  for (let i = 0; i < 10; i++) {
    if (await visible(page, QUESTIONS[lang].warranty)) {
      await page.locator(".wiz__opts .wiz-opt:visible").first().click();
      return;
    }
    await page.waitForTimeout(300);
  }
}

/** The quote's stored payment term, once the wizard has written it. */
async function storedPayment(
  { http, page }: Pick<StoryTools, "http" | "page">,
  auth: Record<string, string>,
  quoteId: string,
): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const q = await (await http(`/api/quotes/${quoteId}`, { headers: auth }))
      .json();
    const payment = (q.terms ?? []).find((
      x: { stepId: string; value: string },
    ) => x.stepId === "payment_terms")?.value;
    if (payment) return payment;
    await page.waitForTimeout(250);
  }
  return "";
}

Deno.test("REQ-699 M20: '$180 al mes' — the payment step asks once or every month, the agreement bills monthly, and signing makes a Field subscription, not a one-off invoice", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { auth } = await signIn(http, page, baseUrl, "es");
    const { quote, conv } = await openWizard({ http, page }, auth, {
      sentence: PAIR2,
      jobName: "Corte de césped",
      cents: 18_000,
    });
    expect.eq(
      await answerUntilPayment(page, "es", "María López", folder),
      "María López",
      "the typed name is in the customer form",
    );

    // Payment: the monthly price is asked about — once, or every month?
    const ask = page.locator('[data-testid="wiz-recurring-ask"]:visible');
    await ask.waitFor({ state: "visible", timeout: 20_000 });
    expect.eq(
      (await ask.innerText()).trim(),
      "Dijiste $180 al mes. ¿Lo cobras una sola vez o cada mes?",
      "the payment step asks about the monthly price",
    );
    const options = await page.locator(".wiz__opts .wiz-opt:visible")
      .allInnerTexts();
    expect(
      options.some((o) => /Recurrente/.test(o)),
      `Recurrente is offered (${options.join(" | ")})`,
    );
    expect(
      options.some((o) => /50\s*\/\s*50/.test(o)),
      `the one-off options stay (${options.join(" | ")})`,
    );
    const bill = page.locator('[data-testid="wiz-recurring-bill"]:visible');
    expect.eq(
      (await bill.innerText()).trim(),
      "Cobrarlo cada mes",
      "one tap bills it every month",
    );
    await page.screenshot({ path: `${folder}/payment-ask.png` });
    // The pick reads back in Spanish in the thread.
    await bill.click({ timeout: 60_000 });
    await see(page, /Pago: Mensual · \$180\/mes/, folder);
    await finishWizard(page, "es");
    expect.eq(
      await storedPayment({ http, page }, auth, quote.id),
      "Monthly · $180/mo",
      "the quote stores the recurring term's English base",
    );

    // The agreement reads it in Spanish, billed every month.
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    });
    await sent.body?.cancel();
    await page.goto(`/q/${quote.id}?lang=es`);
    await expect.see("Mensual · $180/mes", { timeout: 30_000 });
    await expect.see("Se cobra cada mes", { timeout: 10_000 });
    await page.getByText("Se cobra cada mes").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${folder}/agreement-schedule.png` });

    // María signs on the public page (no session: the customer).
    const signed = await http(`/api/quotes/${quote.id}/accept`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "María López" }),
    });
    const accepted = await signed.json();
    expect.eq(accepted.ok, true, `signed: ${JSON.stringify(accepted)}`);

    // No one-off $180 invoice (the demo's INV-001).
    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json() as { quoteId?: string }[];
    expect.eq(
      invoices.filter((i) => i.quoteId === quote.id).length,
      0,
      "a recurring quote is billed by its subscription, not at signing",
    );

    // Campo → Suscripciones: the quote's subscription, in the quote's words.
    await page.goto("/field/subscriptions");
    const fromQuote = page.locator("[data-cy='subs-from-quote']").first();
    await fromQuote.waitFor({ state: "visible", timeout: 30_000 });
    expect.eq(
      (await fromQuote.innerText()).trim(),
      `De ${quote.number} · Mensual · $180/mes`,
      "the subscription names its quote and what it bills",
    );

    // The owner's thread says who signed and where the billing lives.
    await page.goto(`/assistant/${conv.id}`);
    await expect.see(
      `María López firmó ${quote.number} · Mensual · $180/mes — se cobra desde Campo → Suscripciones`,
      { timeout: 30_000 },
    );
  }));

Deno.test("REQ-699 M20: with no price per period stated, Recurring in the payment options opens its form — every 2 weeks, $90, a last day — and the quote stores that schedule", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const { quote } = await openWizard({ http, page }, auth, {
      sentence: "Lawn mowing for Bob Smith, 512-555-0123, front and back yard",
      jobName: "Lawn mowing",
      cents: 4_500,
    });
    await answerUntilPayment(page, "en", "Bob Smith", folder);
    expect.eq(
      await page.locator('[data-testid="wiz-recurring-ask"]:visible').count(),
      0,
      "no price per period was typed, so nothing is asked",
    );

    // Recurring, from the options: its form opens on the quote's total.
    const formOpen = () =>
      page.locator("[data-cy='recurring-form']").filter({ visible: true })
        .count().then((n) => n > 0);
    await clickUntil(
      page,
      ".wiz__opts .wiz-opt:visible:has-text('Recurring')",
      formOpen,
      folder,
    );
    const form = page.locator("[data-cy='recurring-form']");
    expect.eq(
      await form.locator("[data-cy='recurring-amount']").inputValue(),
      "45",
      "the amount opens on the quote's total",
    );
    expect.eq(
      (await form.locator("[data-cy='recurring-preview']").innerText()).trim(),
      "Monthly · $45/mo",
      "monthly is the first pick",
    );
    await form.locator("[data-cy='recurring-biweekly']").click();
    await form.locator("[data-cy='recurring-amount']").fill("90");
    await form.locator("[data-cy='recurring-end']").fill("2027-06-30");
    const preview = "Every 2 weeks · $90/2 wks · until Jun 30, 2027";
    let shown = "";
    for (let i = 0; i < 20 && shown !== preview; i++) {
      shown = (await form.locator("[data-cy='recurring-preview']").innerText())
        .trim();
      if (shown !== preview) await page.waitForTimeout(150);
    }
    expect.eq(shown, preview, "the preview reads the schedule");
    await page.screenshot({ path: `${folder}/recurring-form.png` });

    await form.locator("[data-cy='recurring-use']").click({ timeout: 60_000 });
    await see(page, /Payment: Every 2 weeks · \$90\/2 wks/, folder);
    await finishWizard(page, "en");
    expect.eq(
      await storedPayment({ http, page }, auth, quote.id),
      "Every 2 weeks · $90/2 wks · until 2027-06-30",
      "the quote stores the schedule's English base, its last day ISO",
    );
  }));
