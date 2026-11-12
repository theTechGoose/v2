/**
 * REQ-347 (demo-loop cycle 1, issue M16) — "English preview of a Spanish quote
 * keeps Spanish terms; preview and sent document disagree".
 *
 * A Spanish contractor answers the terms wizard; the send card opens on its
 * own right after the last chip. Flipped to English, its term rows must read
 * like the agreement the customer gets (/q?lang=en): Next week / Estimated:
 * 1 day / 1 year — not the Spanish transcript ("La próxima semana",
 * "Estimado: 1 día", "1 año") with English labels.
 *
 * The conversation is seeded the way the dev seed does it (a quote → a
 * conversation on it → transition-to-terms): no LLM turn.
 *
 * Pages: /assistant/[id] (front-end/islands/AsstChat.tsx; the rows from
 * shared/quote-flow/wizard-terms.ts previewTermRows).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };

/** A signed-in, onboarded, SPANISH account on the page's browser context. */
async function signInSpanish(
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
      ["/api/me", { name: "Usuario Asistente", language: "es" }],
      ["/api/profile/identity", { businessName: "Negocio Asistente" }],
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
    { name: "pm_lang", value: "es", domain: host, path: "/" },
  ]);
  return auth;
}

/** A sent quote, a conversation on it, the hand-off to the terms wizard. */
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
    summary: "Azulejo de cocina — 30 pies²",
    lineItems: [{
      description: "Instalación de azulejo (30 pies²)",
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
const pick = (page: StoryTools["page"], text: RegExp) =>
  visibleOptions(page).filter({ hasText: text }).first().click();

Deno.test("REQ-347: a Spanish contractor's send card, flipped to English right after the wizard, shows English terms (Next week / Estimated: 1 day / 1 year)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signInSpanish("+15125550347", http, page, baseUrl);
    const conversationId = await seedWizard(http, auth);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conversationId}`);
    await page.locator(".wiz__opts, .cust-create").first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    const startQuestion = page.getByText(/cuándo empieza el trabajo/i);
    if ((await startQuestion.count()) === 0) {
      if ((await page.locator(".cust-create").count()) === 0) {
        await page.locator(".wiz-opt--custom:visible").first().click();
      }
      await page.locator(".cust-create input.cust-pick__search").first().fill(
        "Ana Pérez",
      );
      await page.locator(".cust-create input[type=tel]").fill("5125550348");
      await page.locator(".cust-create__btn--primary").click();
    }
    await startQuestion.first().waitFor({ state: "visible", timeout: 20_000 });
    await pick(page, /^\s*La próxima semana\s*$/);
    await page.getByText(/cuánto tiempo tomará el trabajo/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await pick(page, /^\s*1 día\s*$/);
    await page.getByText(/cuándo quieres recibir el pago/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await pick(page, /Pago inmediato/);
    await page.getByText(/cuánto tiempo respaldas tu trabajo/i).first()
      .waitFor({ state: "visible", timeout: 20_000 });
    await pick(page, /^\s*1 año\s*$/);

    // The send card opens on its own, no reload.
    const terms = page.locator(".quote-review__terms");
    await terms.waitFor({ state: "visible", timeout: 20_000 });
    await page.locator(".quote-review__langpill", { hasText: "English" })
      .first().click();
    await page.locator(".quote-review__langpill.is-active", {
      hasText: "English",
    }).waitFor({ state: "visible", timeout: 10_000 });
    const text = (await terms.innerText()).replace(/\s+/g, " ");
    expect(/Next week/.test(text), `start reads Next week (${text})`);
    expect(
      /Estimated: 1 day\b/.test(text),
      `duration reads Estimated: 1 day (${text})`,
    );
    expect(/1 year\b/.test(text), `warranty reads 1 year (${text})`);
    expect(
      !/próxima|día|año|Estimado/i.test(text),
      `no Spanish value in the English preview (${text})`,
    );
  }));
