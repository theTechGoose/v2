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
      `View ${coNumber} as customer`, // REQ-690: one "View as customer" label
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

// REQ-1025 (LOOP-007 cycle 2, q2-7): QA's own message on a signed, invoiced
// Q-001. The reply said "CO-001 added … tap Send CO-001" and "I didn't change
// anything yet" at once, and drew no Send CO-001 button; the follow-up
// "send CO-001 to maria by email" got "Got it — what would you like me to do
// with that?".
Deno.test("REQ-1025 q2-7 (LOOP-007 cycle 2): QA's master bath change order on Q-001 draws one 'Send CO-00N' button with no 'didn't change anything' text, and 'send CO-00N to maria by email' sends it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, {
      name: "CO No Autosend Story",
      businessName: "CO No Autosend LLC",
    });
    const email = "maria@blackhole.postmarkapp.com";
    const customer = await call(http, auth, "POST", "/api/customers", {
      name: "Maria Gonzalez",
      email,
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: customer.id,
      summary: "Master bath — Maria Gonzalez",
      jobName: "Master bath",
      lineItems: [line("Master bath remodel", 1800000)],
      estimatedTotal: 1800000,
      status: "draft",
    });
    await call(http, auth, "POST", "/api/invoices", {
      customerId: customer.id,
      quoteId: quote.id,
      jobName: "Master bath",
      lineItems: [line("Balance", 1800000)],
      amount: 1800000,
      dueDate: "2026-12-30",
    });
    const { number } = await call(http, auth, "GET", `/api/quotes/${quote.id}`);

    const chat = await call(http, auth, "POST", "/api/agents/chat", {
      kind: "text",
      content:
        `change order for maria gonzalez master bath ${number}: she wants to add a recessed shampoo niche and a frameless glass door, add $2,800`,
    });
    const reply = chat.newMessages[chat.newMessages.length - 1];
    expect(
      !reply.content.includes("didn't change anything"),
      `the reply does not contradict itself (${reply.content})`,
    );
    const outcome = reply.payload?.changeOrder ?? {};
    expect.eq(
      outcome.kind,
      "change_order",
      `a change order was made (reply: ${reply.content})`,
    );
    expect.eq(outcome.sent, false, "and NOT sent to Maria");
    const coNumber = (outcome.changeOrderNumber as string) ?? "CO-001";

    await page.goto(`/assistant/${chat.conversation.id}`);
    const send = page.locator("[data-cy='msg-co-send']");
    await send.waitFor({ timeout: 20_000 });
    expect.eq(
      (await send.innerText()).trim(),
      `Send ${coNumber}`,
      "the reply offers the Send button its text promises",
    );

    const followUp = await call(http, auth, "POST", "/api/agents/chat", {
      kind: "text",
      conversationId: chat.conversation.id,
      content: `send ${coNumber} to maria by email`,
    });
    const sent = followUp.newMessages[followUp.newMessages.length - 1];
    expect(
      sent.content.includes(`Sent ${coNumber} to Maria Gonzalez by email`),
      `the lowercase follow-up sends it (got ${sent.content})`,
    );
  }));
