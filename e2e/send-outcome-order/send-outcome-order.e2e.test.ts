/**
 * REQ-452 (demo-loop cycle 3, issue p8-pair7-b) — "'Couldn't send' card
 * renders above a later message".
 *
 * Pair 7 typed a fix on the review step (12:12:36), then hit send
 * (12:12:57); the send failed and the "Couldn't send" card showed ABOVE the
 * message typed before it. The card is the send CTA re-rendered in its
 * outcome state, so it kept the CTA's place from when the wizard finished.
 *
 * This story drafts a quote, answers the terms wizard to the send CTA (the
 * customer has no email or phone, so the send fails), types a message on the
 * review step, sends, reloads the thread and checks the "Couldn't send" card
 * comes AFTER the typed message.
 *
 * Page: front-end/routes/assistant/[threadId].tsx → islands/AsstChat.tsx
 * (ordering: front-end/lib/send-cta-settled.ts orderSendOutcomes).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };
const TYPED = "Quick question about the paint color";

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
    name: "Order User",
    businessName: "Order Business",
  });
  // The UI (and the card's "Couldn't send") in English.
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  });
  await me.body?.cancel();
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

type Msg = { id?: string; kind?: string; payload?: Record<string, unknown> };

/** A locked quote whose terms wizard is answered up to the send CTA, for a
 *  customer with no email or phone. Returns the conversation + quote ids. */
async function quoteAtReview(http: Http, auth: Record<string, string>) {
  const quote = await api(http, auth, "POST", "/quotes", {
    summary: "Interior paint",
    lineItems: [{
      description: "Interior paint",
      quantity: 1,
      unit: "ea",
      price: 45_000,
    }],
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
    customValue: "Nocontact Customer",
  });
  for (let i = 0; i < 15; i++) {
    const snap = await api(
      http,
      auth,
      "GET",
      `/agents/conversations/${convoId}`,
    );
    const msgs = (snap?.messages ?? []) as Msg[];
    if (
      msgs.some((m) =>
        m.kind === "continue_cta" && m.payload?.toPhase === "send"
      )
    ) return { convoId, quoteId: quote.id as string };
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

Deno.test('REQ-452 p8-pair7-b: a message typed on the review step, then a failed send → the "Couldn\'t send" card is drawn AFTER that message', (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const { convoId, quoteId } = await quoteAtReview(http, auth);
    // Typed on the review step, BEFORE the send.
    await api(http, auth, "POST", "/agents/chat", {
      conversationId: convoId,
      content: TYPED,
    });
    // The send — the customer has no email, so it fails.
    await api(
      http,
      auth,
      "POST",
      `/agents/conversations/${convoId}/send-quote`,
      {
        quoteId,
        channel: "email",
        language: "en",
      },
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${convoId}`);
    const failed = page.locator(".continue-cta", {
      hasText: "Couldn't send",
    }).first();
    await failed.waitFor({ state: "visible", timeout: 20_000 });
    const typed = page.locator(".msg--user", { hasText: TYPED }).first();
    await typed.waitFor({ state: "visible", timeout: 20_000 });

    const cardAfterTyped = await page.evaluate(
      ([text]) => {
        const cards = [...document.querySelectorAll(".continue-cta")].filter(
          (el) => /Couldn.t send/.test(el.textContent ?? ""),
        );
        const bubble = [...document.querySelectorAll(".msg--user")].find(
          (el) => (el.textContent ?? "").includes(text),
        );
        if (!cards[0] || !bubble) return null;
        return Boolean(
          bubble.compareDocumentPosition(cards[0]) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
      },
      [TYPED],
    );
    expect.eq(
      cardAfterTyped,
      true,
      'the "Couldn\'t send" card follows the message typed before the send',
    );
  }));
