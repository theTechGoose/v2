/**
 * REQ-315 (demo-loop cycle 1, B2 + m49) — a price on a sent quote can be
 * changed from /quotes, and a chat change order links back to the quote.
 *
 * Demo pair 5 opened their sent Q-001 and found "buttons only Copy link /
 * View as client / Create next invoice. There is NO Edit, no New version, no
 * Change order button." The open panel of an issued, unsigned quote now has
 * "Edit → Version 2": an inline line editor whose Save files the lines as a
 * pending revision (the customer keeps seeing Version 1), after which the
 * panel shows "Unpublished changes" and "Publish revision". A signed quote
 * shows no Edit.
 *
 * m49: "Change order for Dana Whitfield on Q-001: add a heated floor,
 * $1,200." asked "Which customer's job is this change order for?" and the
 * reply had "no link or button to the quote". It now lands on the quote and
 * the reply carries "Open Q-001 → Publish revision".
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
    body: JSON.stringify({ language: "en", name: "Revise Story" }),
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

Deno.test("REQ-315: a sent, unsigned quote gets 'Edit → Version 2' on /quotes; saving a new line price files it as an unpublished revision with 'Publish revision' next to it; a signed quote has no Edit", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await call(http, auth, "POST", "/api/customers", {
      name: "Dana Whitfield",
      email: "dana@blackhole.postmarkapp.com",
      address: "18 Rosewood Ln, Austin, TX",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: customer.id,
      summary: "Bathroom remodel — Dana Whitfield",
      jobName: "Bathroom Remodel Dana",
      lineItems: [
        line("Demo and disposal", 120000),
        line("Plumbing fixtures", 115000),
        line("Tile floor and walls", 480000),
        line("Vanity and lighting", 235000),
      ],
      estimatedTotal: 950000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });

    // The sent quote's panel offers the edit — and says which version it makes.
    await page.goto(`/quotes?open=${quote.id}`);
    const editBtn = page.locator("[data-cy='quote-edit']");
    await editBtn.waitFor({ timeout: 15_000 });
    expect.eq(
      (await editBtn.innerText()).trim(),
      "Edit → Version 2",
      "the edit button names the next version",
    );
    expect.eq(
      await page.locator("[data-cy='quote-publish']").count(),
      0,
      "nothing to publish before an edit",
    );

    // Reprice "Plumbing fixtures" to $1,300 and save.
    await editBtn.click();
    const price1 = page.locator("[data-cy='quote-edit-line-price-1']");
    await price1.waitFor({ timeout: 10_000 });
    expect.eq(
      await price1.inputValue(),
      "1150",
      "the editor shows the live price",
    );
    await price1.fill("1300");
    await expect.see("New total $9,650.00");
    await page.locator("[data-cy='quote-edit-save']").click();

    // The panel re-reads: unpublished changes + publish, and says what happened.
    await page.locator("[data-cy='quote-edit-saved']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Unpublished changes");
    await page.locator("[data-cy='quote-publish']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Publish revision");

    const stored = await call(http, auth, "GET", `/api/quotes/${quote.id}`);
    expect.eq(stored.version ?? 1, 1, "the customer still sees Version 1");
    expect.eq(stored.lineItems[1].price, 115000, "the live line is untouched");
    expect.eq(
      stored.pendingRevision?.lineItems?.length,
      4,
      "the revision keeps four lines — nothing appended",
    );
    expect.eq(
      stored.pendingRevision?.lineItems?.[1]?.price,
      130000,
      "the revision reprices plumbing to $1,300",
    );
    expect.eq(
      stored.pendingRevision?.estimatedTotal,
      965000,
      "the revision's total is $9,650",
    );

    // Publishing makes Version 2 on the same number.
    await page.locator("[data-cy='quote-publish']").click();
    await page.locator("[data-cy='quote-published-note']").waitFor({
      timeout: 15_000,
    });
    const published = await call(http, auth, "GET", `/api/quotes/${quote.id}`);
    expect.eq(published.version, 2, "publishing makes Version 2");
    expect.eq(
      published.estimatedTotal,
      965000,
      "Version 2 carries the new total",
    );

    // A signed quote cannot be edited: no Edit button.
    const signed = await call(http, auth, "POST", "/api/quotes", {
      customerId: customer.id,
      summary: "Deck stain — Dana Whitfield",
      jobName: "Deck stain",
      lineItems: [line("Deck stain", 40000)],
      estimatedTotal: 40000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${signed.id}`, {
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });
    await page.goto(`/quotes?open=${signed.id}`);
    await page.locator("[data-cy='quote-status-badge']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='quote-ledger']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='quote-edit']").count(),
      0,
      "a signed quote has no Edit",
    );
  }));

Deno.test("REQ-315 m49: 'Change order for Dana Whitfield on Q-00N: add a heated floor, $1,200.' never asks which customer, and the reply's 'Open Q-00N → Publish revision' opens the quote with its revision ready to publish", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    // the chat asks onboarding questions first; this account is past them
    await answerQuestions(http, auth, {
      name: "Revise Story",
      businessName: "Revise Story LLC",
    });
    const customer = await call(http, auth, "POST", "/api/customers", {
      name: "Dana Whitfield",
      email: "dana@blackhole.postmarkapp.com",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: customer.id,
      summary: "Bathroom remodel — Dana Whitfield",
      jobName: "Bathroom Remodel Dana",
      lineItems: [
        line("Plumbing fixtures", 115000),
        line("Tile floor and walls", 480000),
      ],
      estimatedTotal: 595000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    const { number } = await call(http, auth, "GET", `/api/quotes/${quote.id}`);
    expect(/^Q-\d+$/.test(number ?? ""), `the quote is numbered (${number})`);

    // The demo's sentence, typed into a fresh conversation.
    const chat = await call(http, auth, "POST", "/api/agents/chat", {
      kind: "text",
      content:
        `Change order for Dana Whitfield on ${number}: add a heated floor, $1,200.`,
    });
    const reply = chat.newMessages[chat.newMessages.length - 1];
    expect(
      !/which customer/i.test(reply.content),
      `no "which customer" question (${reply.content})`,
    );

    await page.goto(`/assistant/${chat.conversation.id}`);
    const link = page.locator("[data-cy='msg-quote-link']");
    await link.waitFor({ timeout: 20_000 });
    expect.eq(
      (await link.innerText()).trim(),
      `Open ${number} → Publish revision`,
      "the reply links to the quote and says what to do there",
    );
    await link.click();
    await page.waitForURL(`**/quotes?open=${quote.id}`, { timeout: 15_000 });
    await page.locator("[data-cy='quote-publish']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Unpublished changes");
    const stored = await call(http, auth, "GET", `/api/quotes/${quote.id}`);
    expect.eq(
      stored.pendingRevision?.lineItems?.length,
      3,
      "the heated floor waits on the same quote as its next version",
    );
  }));
