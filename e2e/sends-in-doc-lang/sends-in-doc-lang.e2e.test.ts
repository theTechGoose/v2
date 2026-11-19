/**
 * REQ-971 — LOOP-007 cycle 1, issue q1-49 [minor/BUG_POLISH]: "'Sends in'
 * defaults to English for a customer the contractor described in Spanish".
 * The contractor must remember to switch to Español.
 *
 * An English-app contractor (who sends in English and Spanish) types the
 * quote in Spanish for Jose Martinez; nobody said what language Jose reads,
 * so Customer.language stays empty (REQ-715 c4-M34), but the quote itself is
 * stamped lang "es" from its typed text (REQ-710). Both send paths should
 * start on the document's own language:
 *
 *  1. /assistant/<thread> review card — "Preview in" / "Sends in" starts on
 *     Español (AsstChat.tsx previewLang).
 *  2. /quotes?open=<id> → Send ▾ → Email — the send dialog's "Sends in"
 *     starts on Español (QuotesPage.tsx → components/QuoteSendDialog.tsx).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

type Http = StoryTools["http"];

/** The tester's Q-002, typed in Spanish in an English app. */
const ES_LINES = [
  "Quitar el piso viejo de la cocina",
  "Instalar piso de vinil nuevo en la cocina",
  "Limpiar y retirar los escombros",
];

async function signIn(http: Http, page: StoryTools["page"], baseUrl: string) {
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  }).then((x) => x.body?.cancel());
  await answerQuestions(http, auth, {
    name: "Luis Ortega",
    businessName: "Ortega Handyman Services",
  });
  // English app, sends in English AND Spanish — both pills are offered.
  await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ commsLanguages: ["en", "es"] }),
  }).then((x) => x.body?.cancel());
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

async function api(
  http: Http,
  auth: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await http(`/api${path}`, {
    method,
    headers: auth,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (r.status >= 400) {
    throw new Error(`${method} ${path} → ${r.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

/** A Spanish-typed quote, locked, its terms answered up to the send CTA;
 *  the customer is a new "Jose Martinez" with no language. */
async function spanishQuoteAtReview(
  http: Http,
  auth: Record<string, string>,
): Promise<{ convoId: string; quoteId: string }> {
  const quote = await api(http, auth, "POST", "/quotes", {
    summary: "Cambio de piso de cocina para Jose Martinez",
    jobName: "Cambio de piso de cocina",
    description: ES_LINES.join("\n"),
    lineItems: [{
      description: "Cambio de piso de cocina",
      quantity: 1,
      unit: "trabajo",
      price: 320_000,
    }],
    estimatedTotal: 320_000,
    status: "draft",
  });
  const conv = await api(http, auth, "POST", "/agents/conversations", {
    quoteId: quote.id,
  });
  const convoId: string = conv?.id ?? conv?.conversation?.id;
  await api(http, auth, "POST", `/agents/conversations/${convoId}/lock-quote`, {
    quoteId: quote.id,
  });
  const trans = await api(
    http,
    auth,
    "POST",
    `/agents/conversations/${convoId}/transition-to-terms`,
    {},
  );
  await api(http, auth, "POST", "/agents/wizard/answer", {
    conversationId: convoId,
    stepId: trans?.activeStepId ?? "customer",
    optionId: "create_new",
    customValue: "Jose Martinez",
  });
  for (let i = 0; i < 15; i++) {
    const snap = await api(
      http,
      auth,
      "GET",
      `/agents/conversations/${convoId}`,
    );
    const msgs = (snap?.messages ?? []) as Array<
      { kind?: string; payload?: Record<string, unknown> }
    >;
    if (
      msgs.some((m) =>
        m.kind === "continue_cta" && m.payload?.toPhase === "send"
      )
    ) return { convoId, quoteId: quote.id };
    const last = [...msgs].reverse().find((m) => m.kind === "wizard");
    const p = (last?.payload ?? {}) as {
      stepId?: string;
      options?: Array<{ id?: string }>;
    };
    const optionId = p.options?.find((o) => o.id && o.id !== "custom")?.id;
    if (!p.stepId || !optionId) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    await api(http, auth, "POST", "/agents/wizard/answer", {
      conversationId: convoId,
      stepId: p.stepId,
      optionId,
    });
  }
  throw new Error("the wizard never reached the send CTA");
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
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
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-971 q1-49: a quote typed in Spanish for a customer with no language — the assistant's 'Preview in' and /quotes' 'Sends in' start on Español in an English app", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const { convoId, quoteId } = await spanishQuoteAtReview(http, auth);
    await page.setViewportSize({ width: 1280, height: 900 });

    // the setup the bug needs: the document is Spanish, Jose has no language
    const q = await api(http, auth, "GET", `/quotes/${quoteId}`);
    expect.eq(q?.lang, "es", "the quote is stamped Spanish (REQ-710)");
    const customers = await api(http, auth, "GET", "/customers") as Array<
      { id: string; name: string; language?: string }
    >;
    const jose = customers.find((c) => c.name === "Jose Martinez");
    expect(!!jose, "Jose Martinez was created by the wizard");
    expect.eq(jose?.language, undefined, "Jose has no language on file");

    // 1 — the assistant's review card
    await page.goto(`/assistant/${convoId}`);
    const review = page.locator(".quote-review").first();
    await review.waitFor({ state: "visible", timeout: 20_000 });
    const previewGroup = review.locator(
      "[role=group]:has(.quote-review__langtoggle-label)",
    ).first();
    const esPill = previewGroup.locator(
      ".quote-review__langpill:has-text('Español')",
    );
    await esPill.waitFor({ state: "visible", timeout: 15_000 });
    // give the island a moment to settle its defaults after hydration
    await page.waitForTimeout(1_500);
    // read both paths first, so one run shows both
    const assistantEs = await esPill.getAttribute("aria-pressed");
    const assistantEn = await previewGroup.locator(
      ".quote-review__langpill:has-text('English')",
    ).getAttribute("aria-pressed");

    // 2 — /quotes?open=<id> → Send ▾ → Email (the panel's Send ▾ is on an
    // issued quote — a draft's one primary is "Finish and send", REQ-686)
    await api(http, auth, "PUT", `/quotes/${quoteId}`, {
      status: "sent",
      sentAt: new Date().toISOString(),
    });
    await page.goto(`/quotes?open=${quoteId}`);
    await page.locator("[data-cy='quote-open-panel']").waitFor({
      timeout: 15_000,
    });
    const menu = page.locator("[data-cy='quote-panel-send-menu']");
    await clickUntil(
      page,
      "[data-cy='quote-panel-send']",
      async () => (await menu.count()) > 0,
    );
    await page.locator("[data-cy='quote-panel-send-email']").click();
    const dialog = page.locator("[data-cy='send-dialog']");
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
    await page.locator("[data-cy='send-lang-es']").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.waitForTimeout(1_000);
    const quotesEs = await page.locator("[data-cy='send-lang-es']")
      .getAttribute("aria-pressed");

    expect.eq(
      `assistant es=${assistantEs} en=${assistantEn} · /quotes es=${quotesEs}`,
      "assistant es=true en=false · /quotes es=true",
      "both 'Preview in' (assistant) and 'Sends in' (/quotes) start on Español — the quote's own language",
    );
  }));
