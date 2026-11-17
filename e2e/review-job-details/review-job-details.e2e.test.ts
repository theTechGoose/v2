/**
 * REQ-237 (demo issue M17) — the review/send card said "Add the job details"
 * and dropped the line item on a chat-drafted quote.
 *
 * A quote drafted in chat (create_quote) is stored with summary + lineItems
 * and no description. This story stores one exactly that way through the
 * app's API, locks it (the card's "Lock it in" route), answers the terms
 * wizard to the send CTA, opens the thread in a browser and reads the review
 * card's "Job details": the line item and its amount must be there, not the
 * empty prompt.
 *
 * Page: front-end/routes/assistant/[threadId].tsx → islands/AsstChat.tsx
 * (review card job details, shared/quote-flow/review-job-details.ts).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

/** a fresh number per sign-in, so parallel stories never share an account */
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };
const LINE = "Pintura de baño";

type Http = StoryTools["http"];

/** A signed-in, onboarded account; returns the API headers (with cookie). */
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
    name: "Review User",
    businessName: "Review Business",
  });
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

/** A chat-drafted quote, locked, its terms answered up to the send CTA. */
async function chatDraftedQuoteAtReview(
  http: Http,
  auth: Record<string, string>,
): Promise<string> {
  // What handle-chat-message's create_quote persists: summary, lineItems,
  // estimatedTotal, status draft — and no description.
  const quote = await api(http, auth, "POST", "/quotes", {
    summary: LINE,
    lineItems: [{ description: LINE, quantity: 1, unit: "ea", price: 45_000 }],
    estimatedTotal: 45_000,
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
    customValue: "Cliente Baño",
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
    ) return convoId;
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

Deno.test("REQ-237: a chat-drafted quote's review card shows its line item under Job details, not 'Add the job details'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const convoId = await chatDraftedQuoteAtReview(http, auth);

    await page.goto(`/assistant/${convoId}`);
    const review = page.locator(".quote-review").first();
    await review.waitFor({ state: "visible", timeout: 20_000 });

    const section = review.locator(".quote-review__section", {
      has: page.locator('[data-cy="review-job-details-edit"]'),
    });
    await section.waitFor({ state: "visible" });
    const text = (await section.innerText()).replace(/\s+/g, " ");
    const lines = section.locator('[data-cy="review-job-detail-line"]');
    expect.eq(
      await lines.count(),
      1,
      `one job-details line for the one line item (section: "${text}")`,
    );
    expect(
      (await lines.first().innerText()).includes(LINE),
      `the line reads "${LINE}" (section: "${text}")`,
    );
    expect(
      (await section.locator('[data-cy="review-job-detail-amount"]').first()
        .innerText()).includes("$450"),
      `the line carries its amount $450 (section: "${text}")`,
    );
    expect.eq(
      await section.locator(".quote-review__details-text--empty").count(),
      0,
      `no "Add the job details" prompt (section: "${text}")`,
    );
  }));
