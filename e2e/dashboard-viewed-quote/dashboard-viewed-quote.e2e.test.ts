/**
 * REQ-956 (LOOP-007 q1, q1-31) — "Dashboard says no quotes are pending while
 * /quotes shows one out for response". The owner sends a quote; the customer
 * opens its /q link once in their own browser (sent → viewed). The dashboard
 * must then agree with /quotes' "Out for response · 1 quote waiting":
 * QUOTES PENDING 1, the money bar's "1 estimate out", and the quote in the
 * "Quotes awaiting signature" panel.
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Viewed Quote" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: Record<string, unknown>,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

Deno.test("REQ-956 (LOOP-007 q1-31): after the customer opens a sent quote, the dashboard still shows it pending — QUOTES PENDING 1, '1 estimate out', the awaiting-signature row — matching /quotes' '1 quote waiting'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Viewed Quote" });
    const dana = await post(http, auth, "/api/customers", {
      name: "Dana Ruiz",
    });
    const q = await post(http, auth, "/api/quotes", {
      customerId: dana.id,
      jobName: "Roof patch",
      summary: "Roof patch",
      lineItems: [{
        description: "Patch",
        quantity: 1,
        unit: "job",
        price: 380_000,
      }],
      estimatedTotal: 380_000,
    });
    await (await http(`/api/quotes/${q.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent", sentAt: new Date().toISOString() }),
    })).body?.cancel();

    // the customer opens the link once, in their own browser (no session)
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const customerCtx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    try {
      const cx = await customerCtx.newPage();
      // the PublicQuoteView island fetches the quote client-side: wait for
      // that first (non-poll) GET, the one that records the open
      const opened = cx.waitForResponse(
        (r) =>
          r.url().includes(`/api/quotes/${q.id}/public`) &&
          !r.url().includes("refresh=1"),
        { timeout: 30_000 },
      );
      await cx.goto(`${baseUrl}/q/${q.id}`);
      expect.eq((await opened).status(), 200, "the customer's /q fetch");
    } finally {
      await customerCtx.close();
    }
    let status = "";
    for (let i = 0; i < 25 && status !== "viewed"; i++) {
      status = (await (await http(`/api/quotes/${q.id}`, { headers: auth }))
        .json()).status;
      if (status !== "viewed") await page.waitForTimeout(200);
    }
    expect.eq(status, "viewed", "the customer's open flips sent → viewed");

    // /quotes: out for response, 1 quote waiting
    await page.goto("/quotes");
    const out = page.locator(".qkpi__cell--accent .qkpi__sub");
    await out.waitFor({ timeout: 20_000 });
    expect.eq(squash(await out.innerText()), "1 quote waiting", "/quotes out for response");

    // /dashboard must agree
    await page.goto("/dashboard");
    const estimates = page.locator(
      "[data-cy='money-col'][data-bucket='estimates']",
    );
    await estimates.waitFor({ timeout: 20_000 });
    const kpi = page.locator(".kpi", { hasText: "Quotes pending" });
    await kpi.locator(".kpi__val").waitFor({ timeout: 20_000 });
    const panel = page.locator(".panel", {
      has: page.locator(".panel__title", {
        hasText: "Quotes awaiting signature",
      }),
    });
    await panel.waitFor({ timeout: 20_000 });
    // the lists load after the shell: give the panel its data before reading
    await page.waitForFunction(
      () => !document.querySelector(".panel__empty[aria-busy='true']"),
      undefined,
      { timeout: 20_000 },
    );
    const facts = await page.evaluate(() => {
      const t = (el: Element | null | undefined) =>
        ((el as HTMLElement | null | undefined)?.innerText ?? "").replace(/\s+/g, " ").trim();
      const kpi = [...document.querySelectorAll(".kpi")].find((k) =>
        t(k.querySelector(".kpi__label")).toLowerCase() === "quotes pending"
      );
      const panel = [...document.querySelectorAll(".panel")].find((p) =>
        t(p.querySelector(".panel__title")).toLowerCase() === "quotes awaiting signature"
      );
      return {
        pending: t(kpi?.querySelector(".kpi__val")),
        estimates: t(
          document.querySelector(
            "[data-cy='money-col'][data-bucket='estimates']",
          ),
        ),
        rows: [...(panel?.querySelectorAll(".quote-item__client") ?? [])].map(
          t,
        ),
        empty: t(panel?.querySelector(".panel__empty")),
      };
    });
    expect.eq(facts.pending, "1", `QUOTES PENDING (${JSON.stringify(facts)})`);
    // REQ-972 (q1-52): the money bar calls a sent quote "quote out"
    expect.eq(facts.estimates, "$3,800 1 quote out", "money bar estimates");
    expect.eq(facts.rows.join(" | "), "Dana Ruiz", `awaiting-signature rows (empty line: "${facts.empty}")`);
  }));
