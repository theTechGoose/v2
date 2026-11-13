/**
 * REQ-676 — demo-loop cycle 5, issue c1-M9: "Close preview resets the
 * warranty question".
 *
 * The review card's X (aria-label "Close preview") used to call
 * goBackWizard(): the server dropped the last term answer and the wizard
 * re-asked it. Now it is a pure close: the server transcript keeps every
 * answered term (the send CTA included), the thread shows a "Ready to send"
 * banner whose Review button reopens the same review.
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
  await answerQuestions(http, auth, {
    name: "Priya Nair",
    businessName: "Nair Kitchen & Bath",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
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

type Msg = { id: string; kind?: string; payload?: Record<string, unknown> };

async function transcript(
  http: Http,
  auth: Record<string, string>,
  convoId: string,
): Promise<Msg[]> {
  const snap = await api(http, auth, "GET", `/agents/conversations/${convoId}`);
  return (snap?.messages ?? []) as Msg[];
}

const picks = (msgs: Msg[]) =>
  msgs.filter((m) => typeof m.payload?.wizardStepId === "string").length;
const hasSendCta = (msgs: Msg[]) =>
  msgs.some((m) => m.kind === "continue_cta" && m.payload?.toPhase === "send");

Deno.test("REQ-676 c1-M9: the review's X closes it without undoing the last term; Review reopens it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const { convoId } = await quoteAtReview(http, auth);
    const before = await transcript(http, auth, convoId);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(`/assistant/${convoId}`);
    const review = page.locator(".quote-review");
    await review.first().waitFor({ state: "visible", timeout: 20_000 });

    // The demo's step: the X in the review's header.
    await clickUntil(
      page,
      ".quote-review__close",
      async () => (await review.count()) === 0,
    );
    expect.eq(await review.count(), 0, "the X closes the review");
    // Give a (wrong) rewind time to land server-side before reading it.
    await page.waitForTimeout(1_500);

    const after = await transcript(http, auth, convoId);
    expect(
      hasSendCta(after),
      "closing the review keeps the wizard complete (the send CTA stays)",
    );
    expect.eq(
      picks(after),
      picks(before),
      "closing the review keeps every answered term (the warranty included)",
    );
    expect.eq(
      await page.locator(".continue-cta .continue-cta__btn").count(),
      1,
      "a Ready-to-send banner offers a way back into the review",
    );

    await clickUntil(
      page,
      ".continue-cta .continue-cta__btn",
      async () => (await review.count()) > 0,
    );
    expect(
      (await review.count()) > 0,
      "Review reopens the same review",
    );
  }));
