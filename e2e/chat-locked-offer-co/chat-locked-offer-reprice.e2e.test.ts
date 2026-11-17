/**
 * REQ-767 (demo-loop cycle 5v2, m43 — the verifier's re-test of REQ-664) on
 * the real app. verify1b fleet-4 stdout:32-33: on Carmen Núñez's SIGNED
 * Q-001 (one line, "Reparar fuga debajo del fregadero …" $350), "On Q-001,
 * lower the line to $300 — I'm giving Carmen a discount." got a text-only
 * "…a $100 discount?" with no button, and in a new thread "Update Carmen
 * Núñez's plumbing quote Q-001: the sink repair line should be $400 instead
 * of $350." got the bare refusal with only "Open Q-001".
 *
 * Now both are read in code: the reply offers "Make change order −$50 for
 * Reparar fuga…" (one tap makes it, unsent) and "+$50" in the new thread.
 *
 * Page: /assistant/:id (front-end/islands/AsstChat.tsx, [data-cy=msg-co-offer]);
 * server: handle-chat-message (parseLineRepriceAsk) + revise-quote (the offer).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Locked Reprice Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

async function call(
  http: StoryTools["http"],
  auth: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers: auth,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

const line = (description: string, price: number) => ({
  description,
  quantity: 1,
  unit: "job",
  price,
});

const SINK =
  "Reparar fuga debajo del fregadero (incluye cambiar llave del fregadero)";

Deno.test("REQ-767 m43: on the signed one-line Spanish Q-001, 'lower the line to $300' offers 'Make change order −$50 …' (one tap makes it), and a new thread's 'sink repair line should be $400' offers +$50", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, {
      name: "Locked Reprice Story",
      businessName: "Locked Reprice Story LLC",
    });
    const carmen = await call(http, auth, "POST", "/api/customers", {
      name: "Carmen Núñez",
      email: "carmen@blackhole.postmarkapp.com",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: carmen.id,
      summary: "Reparación de plomería — Carmen Núñez",
      jobName: "Reparación de plomería",
      lineItems: [line(SINK, 35000)],
      estimatedTotal: 35000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    await call(http, JSON_HEADERS, "POST", `/api/quotes/${quote.id}/accept`, {
      name: "Carmen Núñez",
      version: 1,
    });
    const { number } = await call(http, auth, "GET", `/api/quotes/${quote.id}`);

    // try 2 of the verifier: the demo's model answered this in text only
    const chat = await call(http, auth, "POST", "/api/agents/chat", {
      kind: "text",
      content:
        `On ${number}, lower the line to $300 — I'm giving Carmen a discount.`,
    });
    const reply = chat.newMessages[chat.newMessages.length - 1];
    expect.eq(reply.payload?.quoteRevision?.kind, "locked", reply.content);
    expect.eq(
      reply.payload?.quoteRevision?.changeOrderOffer?.deltaCents,
      -5000,
      "the difference is $350 → $300",
    );

    await page.goto(`/assistant/${chat.conversation.id}`);
    const offer = page.locator("[data-cy='msg-co-offer']");
    await offer.waitFor({ timeout: 20_000 });
    expect(
      (await offer.innerText()).trim().startsWith(
        "Make change order −$50 for Reparar fuga",
      ),
      "the one-tap offer names −$50 and the line",
    );
    const open = page.locator("[data-cy='msg-co-open']");
    for (let i = 0; i < 20 && await open.count() === 0; i++) {
      if (await offer.count() > 0) {
        await offer.click({ timeout: 2_000 }).catch(() => {});
      }
      await page.waitForTimeout(500);
    }
    await open.waitFor({ timeout: 20_000 });
    const ledger = await call(
      http,
      auth,
      "GET",
      `/api/quotes/${quote.id}/ledger`,
    );
    const cos = (ledger.changeOrders ?? []) as { deltaAmountCents: number }[];
    expect.eq(
      JSON.stringify(cos.map((c) => c.deltaAmountCents)),
      JSON.stringify([-5000]),
      "exactly one change order, −$50",
    );

    // try 3: a new thread, the line named in English
    const fresh = await call(http, auth, "POST", "/api/agents/chat", {
      kind: "text",
      content:
        `Update Carmen Núñez's plumbing quote ${number}: the sink repair line should be $400 instead of $350.`,
    });
    const r3 = fresh.newMessages[fresh.newMessages.length - 1];
    expect.eq(
      r3.payload?.quoteRevision?.changeOrderOffer?.deltaCents,
      5000,
      r3.content,
    );
    const after = await call(http, auth, "GET", `/api/quotes/${quote.id}`);
    expect.eq(after.lineItems[0].price, 35000, "Q-001's line stays");
  }));
