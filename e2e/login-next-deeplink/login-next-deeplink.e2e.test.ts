/**
 * REQ-1153 (LOOP-007 cycle 3, q3-82) — "Logged-out deep link lands on the marketing home, not
 * login". The owner alert's "Answer the question" link is ${APP_URL}/quotes?open=<id>
 * (send-inquiry-alert / send-decision-alert). An owner who has signed out opens it: the server
 * gate must send her to /login?next=/quotes?open=<id> (not the marketing home "/"), and after
 * her phone and the code 000000 she must end on /quotes?open=<id> with that quote's panel open —
 * not on the dashboard.
 *
 * Gates: front-end/routes/<app>/_middleware.ts; sign-in hand-off: islands/LoginForm.tsx →
 * routes/verify.tsx → islands/CodeInput.tsx.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"], local: string) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1${local}`, code: "000000" }),
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
    body: JSON.stringify({ language: "en" }),
  });
  await me.body?.cancel();
  // every onboarding question answered, so a fresh code lands on the plain dashboard (not /welcome)
  await answerQuestions(http, auth, {
    name: "Deep Link Story",
    businessName: "Deep Link LLC",
  });
  return { auth };
}

async function call(
  http: StoryTools["http"],
  auth: Record<string, string>,
  method: string,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method,
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

/** a signed-out owner with one sent quote; returns her local phone and the deep link to it */
async function signedOutOwnerWithQuote(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const local = `512${digits()}`;
  const { auth } = await signIn(http, local);
  const customer = await call(http, auth, "POST", "/api/customers", {
    name: "Hans Hansen",
    email: "hans@blackhole.postmarkapp.com",
    address: "725 Frederick Rd, Rockingham, VA",
  });
  const quote = await call(http, auth, "POST", "/api/quotes", {
    customerId: customer.id,
    summary: "Deck rebuild — Hans Hansen",
    jobName: "Deck rebuild",
    lineItems: [{
      description: "Deck rebuild",
      quantity: 1,
      unit: "job",
      price: 100000,
    }],
    estimatedTotal: 100000,
    status: "draft",
  });
  await call(http, auth, "PUT", `/api/quotes/${quote.id}`, { status: "sent" });

  // signed out: the server session is gone and the browser carries no session cookie
  const out = await http("/api/auth/logout", { method: "POST", headers: auth });
  await out.body?.cancel();
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].map((domain) => ({
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    })),
  );
  return { local, deepLink: `/quotes?open=${quote.id}` };
}

/** on /login: phone, then the code 000000; resolves once the tab has left /verify */
async function phoneAndCode(page: StoryTools["page"], local: string) {
  await page.locator("input[type='tel']").waitFor({ timeout: 20_000 });
  await page.locator("input[type='tel']").fill(local);
  await page.locator("button[type='submit']").click();
  await page.waitForURL((u: URL) => u.pathname === "/verify", {
    timeout: 20_000,
  });
  const firstSlot = page.locator(".code-input input").first();
  await firstSlot.waitFor({ timeout: 20_000 });
  await firstSlot.fill("000000");
  await page.waitForURL((u: URL) => u.pathname !== "/verify", {
    timeout: 30_000,
  });
  await page.waitForLoadState("domcontentloaded");
}

async function onTheQuote(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
  deepLink: string,
) {
  const after = new URL(page.url());
  expect.eq(
    `${after.pathname}${after.search}`,
    deepLink,
    `after the code she is back on the quote she asked for (ended on ${after.pathname}${after.search})`,
  );
  await page.locator("[data-cy='quote-status-badge']").waitFor({
    timeout: 20_000,
  });
  expect.eq(
    (await page.locator("[data-cy='quote-status-badge']").textContent())
      ?.trim(),
    "Sent",
    "that quote's panel is open",
  );
}

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): signed out, the owner opens an alert's /quotes?open=<id> — /login?next=…, phone + 000000, and she ends on that quote, not '/' or the dashboard", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { local, deepLink } = await signedOutOwnerWithQuote(
      http,
      page,
      baseUrl,
    );
    await page.goto(deepLink);
    const landed = new URL(page.url());
    expect.eq(
      landed.pathname,
      "/login",
      `a logged-out deep link goes to /login, not the marketing home (landed on ${landed.pathname}${landed.search})`,
    );
    expect.eq(
      landed.searchParams.get("next"),
      deepLink,
      "the page asked for rides along as ?next=",
    );
    await phoneAndCode(page, local);
    await onTheQuote(page, expect, deepLink);
  }));

Deno.test("REQ-1153 (LOOP-007 q3, q3-82): /login?next=/quotes?open=<id> carries next through /verify — after phone + 000000 she is on that quote, not /dashboard", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { local, deepLink } = await signedOutOwnerWithQuote(
      http,
      page,
      baseUrl,
    );
    await page.goto(`/login?next=${encodeURIComponent(deepLink)}`);
    await phoneAndCode(page, local);
    await onTheQuote(page, expect, deepLink);
  }));
