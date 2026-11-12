/**
 * REQ-490 — demo-loop cycle 3, issue M19: "picking VISTA PREVIA EN English
 * switches MY controls to English too (READY TO SEND, PREVIEW IN, SEND AS,
 * Send…)".
 *
 * The send-review card rendered its own controls with tFor(previewLang, …),
 * the DOCUMENT language. In the browser now: a contractor whose app is in
 * Spanish (and who sends in English and Spanish) previews the quote in
 * English — the document flips to English ("Quote + Agreement", "Total
 * due"…) while the card's controls stay Spanish: "Vista previa en",
 * "Enviar como", the "Cotización + Acuerdo" / "Factura" pills, "Enviar…".
 *
 * Page: front-end/routes/assistant/[threadId].tsx → islands/AsstChat.tsx.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

const EN_LINES = [
  "Remove old tub/shower combo",
  "Install curbless walk-in shower",
  "Porcelain tile 12x24 on walls",
];
const ES_LINES = [
  "Retirar la bañera/ducha antigua",
  "Instalar ducha a nivel del suelo",
  "Azulejos de porcelana 12x24 en paredes",
];

type Http = StoryTools["http"];

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
  const auth = { ...JSON_HEADERS, cookie };
  await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es" }),
  }).then((x) => x.body?.cancel());
  await answerQuestions(http, auth, {
    name: "Priya Nair",
    businessName: "Nair Kitchen & Bath",
  });
  // The demo's account: a Spanish app that sends in English AND Spanish —
  // the review card offers the "Vista previa en" English | Español toggle.
  await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ commsLanguages: ["en", "es"] }),
  }).then((x) => x.body?.cancel());
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "es", domain: host, path: "/" },
  ]);
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

/** The quote as the picker left it (details in English + Spanish), locked,
 *  its terms answered up to the send CTA. */
async function quoteAtReview(
  http: Http,
  auth: Record<string, string>,
): Promise<{ convoId: string; quoteId: string }> {
  const quote = await api(http, auth, "POST", "/quotes", {
    summary: "Master bath remodel",
    jobName: "Master Bath Remodel",
    description: EN_LINES.join("\n"),
    descriptionByLang: {
      en: EN_LINES.join("\n"),
      es: ES_LINES.join("\n"),
    },
    lang: "en",
    lineItems: [{
      description: "Master bath remodel",
      quantity: 1,
      unit: "ea",
      price: 2_800_000,
    }],
    estimatedTotal: 2_800_000,
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
    customValue: "Maria Gutierrez",
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

/** An island may still be hydrating when its button appears: click until
 *  the page shows the effect. */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
) {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch { /* not clickable yet */ }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
}

Deno.test("REQ-490 M19: a Spanish app previews the quote in English → the document is English, the card's controls stay Spanish", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const { convoId } = await quoteAtReview(http, auth);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(`/assistant/${convoId}`);
    const review = page.locator(".quote-review").first();
    await review.waitFor({ state: "visible", timeout: 20_000 });
    const heading = review.locator(".quote-review__kind").first();
    const text = async (sel: string) =>
      (await review.locator(sel).first().innerText()).replace(/\s+/g, " ")
        .trim();

    // The demo's step: "Vista previa en" → English.
    await clickUntil(
      page,
      ".quote-review__langpill:has-text('English')",
      async () => (await heading.innerText()).includes("Quote + Agreement"),
    );
    expect(
      (await heading.innerText()).includes("Quote + Agreement"),
      `the DOCUMENT follows the English preview ("${await heading
        .innerText()}")`,
    );

    // The contractor's controls stay in the app language (Spanish).
    const labels = (await review.locator(".quote-review__langtoggle-label")
      .allInnerTexts()).map((s) => s.trim().toLowerCase());
    expect.eq(
      JSON.stringify(labels),
      JSON.stringify(["vista previa en", "enviar como"]),
      "the toggle labels stay Spanish",
    );
    const pills = (await review.locator(
      "[role=group]:has(.quote-review__langtoggle-label) .quote-review__langpill",
    ).allInnerTexts()).map((s) => s.trim());
    expect(
      pills.includes("Cotización + Acuerdo") && pills.includes("Factura"),
      `the Send as pills stay Spanish (${JSON.stringify(pills)})`,
    );
    const send = await text(".quote-review__send-main");
    expect(
      send.startsWith("Enviar"),
      `the Send button stays Spanish ("${send}")`,
    );
    const close = await review.locator(".quote-review__close").first()
      .getAttribute("aria-label");
    expect.eq(close, "Cerrar vista previa", "the close control stays Spanish");
    const caret = await review.locator(
      ".quote-review__send-split > .quote-review__send-caret",
    ).first().getAttribute("aria-label");
    expect.eq(caret, "Elige cómo enviar", "the send caret stays Spanish");
    const chip = await text(".quote-review__chip");
    expect(
      !/^(ready|draft|sent)/i.test(chip),
      `the status chip stays Spanish ("${chip}")`,
    );
  }));
