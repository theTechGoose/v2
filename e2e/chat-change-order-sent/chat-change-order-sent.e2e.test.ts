/**
 * REQ-456 (demo-loop cycle 3, M25) — "Make a change order … and send it to
 * her" looked ignored: the reply said "I've sent you the link to share" and
 * showed only "Open Q-001". The change-order alert had emailed the customer.
 * The reply now says what reached the customer ("Sent CO-001 to Dana
 * Whitfield by email (…)") and carries the CO number with "Open CO-001 as
 * customer" and a Copy link button.
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
    body: JSON.stringify({ language: "en", name: "CO Send Story" }),
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

Deno.test("REQ-456 M25: a chat change order on an invoiced job says it was sent to the customer by email, and the reply shows CO-00N with 'Open as customer' (→ /co) and 'Copy link'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, {
      name: "CO Send Story",
      businessName: "CO Send Story LLC",
    });
    const email = "dana@blackhole.postmarkapp.com";
    const customer = await call(http, auth, "POST", "/api/customers", {
      name: "Dana Whitfield",
      email,
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: customer.id,
      summary: "Bathroom remodel — Dana Whitfield",
      jobName: "Bathroom Remodel Dana",
      lineItems: [line("Tile floor and walls", 595000)],
      estimatedTotal: 595000,
      status: "draft",
    });
    await call(http, auth, "POST", "/api/invoices", {
      customerId: customer.id,
      quoteId: quote.id,
      jobName: "Bathroom Remodel Dana",
      lineItems: [line("Balance", 595000)],
      amount: 595000,
      dueDate: "2026-12-30",
    });
    const { number } = await call(http, auth, "GET", `/api/quotes/${quote.id}`);

    const chat = await call(http, auth, "POST", "/api/agents/chat", {
      kind: "text",
      content:
        `Change order for Dana Whitfield on ${number}: add a heated floor, $1,200. Send it to her.`,
    });
    const reply = chat.newMessages[chat.newMessages.length - 1];
    const outcome = reply.payload?.changeOrder ?? {};
    expect.eq(outcome.kind, "change_order", "a change order was raised");
    const coNumber = outcome.changeOrderNumber as string;
    expect(/^CO-\d+$/.test(coNumber ?? ""), `numbered (${coNumber})`);
    expect(
      reply.content.includes(
        `Sent ${coNumber} to Dana Whitfield by email (${email})`,
      ),
      `the reply says it reached Dana (${reply.content})`,
    );
    expect(
      !reply.content.includes("sent you the link"),
      `no "I've sent you the link to share" (${reply.content})`,
    );

    await page.goto(`/assistant/${chat.conversation.id}`);
    const open = page.locator("[data-cy='msg-co-open']");
    await open.waitFor({ timeout: 20_000 });
    expect.eq(
      (await open.innerText()).trim(),
      `Open ${coNumber} as customer`,
      "the reply names the change order",
    );
    const href = await open.getAttribute("href");
    expect(
      (href ?? "").startsWith(`/co/${outcome.changeOrderId}`),
      `the link is the customer's approval page (${href})`,
    );
    expect.eq(
      (await page.locator("[data-cy='msg-co-copy']").innerText()).trim(),
      `Copy ${coNumber} link`,
      "and a Copy link button",
    );
    await page.goto(href!);
    await expect.see(coNumber);
  }));
