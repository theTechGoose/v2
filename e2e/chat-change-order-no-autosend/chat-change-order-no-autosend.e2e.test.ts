/**
 * REQ-652 (demo-loop cycle 5, M8) — "Make a change order on Q-001: …" emailed
 * and texted the customer at once (fleet-4: "Sent CO-002 to Dana Whitfield by
 * email" after a plain "make"). A chat change order is now MADE unsent: the
 * reply says it has not been sent and offers Send CO-00N (primary), Open as
 * customer (preview) and Copy link. Tapping Send sends it and the next reply
 * says what reached the customer.
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
    body: JSON.stringify({ language: "en", name: "CO No Autosend Story" }),
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

Deno.test("REQ-652 M8 (cycle 5): 'Make a change order' in chat makes it unsent with Send / Preview / Copy link; tapping Send CO-00N sends it to the customer", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, {
      name: "CO No Autosend Story",
      businessName: "CO No Autosend LLC",
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
        `Make a change order for Dana Whitfield on ${number}: add a heated floor, $1,200.`,
    });
    const reply = chat.newMessages[chat.newMessages.length - 1];
    const outcome = reply.payload?.changeOrder ?? {};
    expect.eq(outcome.kind, "change_order", "a change order was made");
    expect.eq(outcome.sent, false, "and NOT sent to Dana");
    const coNumber = outcome.changeOrderNumber as string;
    expect(/^CO-\d+$/.test(coNumber ?? ""), `numbered (${coNumber})`);
    expect(
      !/\bSent\b/.test(reply.content) &&
        reply.content.includes("not been sent"),
      `the reply says it has not been sent (${reply.content})`,
    );

    await page.goto(`/assistant/${chat.conversation.id}`);
    const send = page.locator("[data-cy='msg-co-send']");
    await send.waitFor({ timeout: 20_000 });
    expect.eq(
      (await send.innerText()).trim(),
      `Send ${coNumber}`,
      "the reply offers Send",
    );
    expect.eq(
      (await page.locator("[data-cy='msg-co-open']").innerText()).trim(),
      `Open ${coNumber} as customer`,
      "and Preview",
    );
    expect.eq(
      (await page.locator("[data-cy='msg-co-copy']").innerText()).trim(),
      `Copy ${coNumber} link`,
      "and Copy link",
    );

    await send.click();
    await expect.see(`Sent ${coNumber} to Dana Whitfield by email (${email})`);
    await expect.eq(
      await page.locator("[data-cy='msg-co-send']").count(),
      0,
      "Send is gone once it is sent",
    );
  }));
