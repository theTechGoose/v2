/**
 * REQ-1030 (LOOP-007 cycle 2, q2-14) — the owner had the assistant make CO-001
 * on Maria Gonzalez's signed Q-001 without asking to send it (REQ-652: it
 * stays unsent until an explicit Send). /quotes then said
 *   "CO-001 is waiting on Maria Gonzalez."
 * though CO-001 never reached her. The pipeline must not say an unsent change
 * order is waiting on the customer — and must still name it as not sent.
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
    body: JSON.stringify({ language: "en", name: "CO Unsent Pipeline Story" }),
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
  unit: "ea",
  price,
});

Deno.test("REQ-1030 (LOOP-007 q2-14): a change order the assistant made but never sent is not 'waiting on' the customer in the /quotes pipeline", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, {
      name: "CO Unsent Pipeline Story",
      businessName: "CO Unsent Pipeline LLC",
    });
    const maria = await call(http, auth, "POST", "/api/customers", {
      name: "Maria Gonzalez",
      email: "maria@blackhole.postmarkapp.com",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: maria.id,
      summary: "Kitchen remodel — Maria Gonzalez",
      jobName: "Kitchen remodel",
      lineItems: [line("Cabinets", 1200000)],
      estimatedTotal: 1200000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    await call(http, JSON_HEADERS, "POST", `/api/quotes/${quote.id}/accept`, {
      name: "Maria Gonzalez",
      version: 1,
    });
    const { number } = await call(http, auth, "GET", `/api/quotes/${quote.id}`);

    // The tester's ask — "make", not "send".
    const chat = await call(http, auth, "POST", "/api/agents/chat", {
      kind: "text",
      content:
        `Make a change order for Maria Gonzalez on ${number}: add upgraded countertops, $2,800.`,
    });
    const reply = chat.newMessages[chat.newMessages.length - 1];
    const outcome = reply.payload?.changeOrder ?? {};
    expect.eq(
      outcome.kind,
      "change_order",
      `a change order was made (${reply.content})`,
    );
    expect.eq(outcome.sent, false, "and NOT sent to Maria (REQ-652)");
    const coNumber = outcome.changeOrderNumber as string;

    await page.goto("/quotes");
    const hero = page.locator(".qph");
    await hero.waitFor({ timeout: 20_000 });
    // the hero names the change order once the cards are in
    for (let i = 0; i < 40; i++) {
      if ((await hero.innerText()).includes(coNumber)) break;
      await page.waitForTimeout(500);
    }
    const heroText = (await hero.innerText()).replace(/\s+/g, " ").trim();
    expect.eq(
      await page.locator("[data-cy='quotes-hero-co-waiting']").count(),
      0,
      `no "waiting on the customer" line for an unsent change order (hero: "${heroText}")`,
    );
    expect(
      !heroText.includes(`${coNumber} is waiting on Maria Gonzalez`),
      `the hero does not say "${coNumber} is waiting on Maria Gonzalez" (hero: "${heroText}")`,
    );
    expect(
      heroText.includes(coNumber),
      `the unsent ${coNumber} is still named in the hero, not hidden (hero: "${heroText}")`,
    );
  }));
