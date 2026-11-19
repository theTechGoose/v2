/**
 * REQ-1085 (LOOP-007 cycle 3, issue q3-10; extends REQ-961 to /quotes) —
 * Raphael: "test every single aspect of this application … one Opus agent per
 * issue to do root cause analysis, then one to write the test, then one to fix
 * it and make it green."
 *
 * A $6,450.50 quote reads "$6,450.50" on /q, the agreement and the PDF, but
 * the owner's /quotes "Decided this month" row printed "$6,451" (and an open
 * $6,450.50 quote's card the same): one quote's total went through the
 * no-cents KPI formatter fmtMoney.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const CENTS = 645_050;
const EXACT = "$6,450.50";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, { name: "Quote Cents Story" });
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

async function sentQuote(
  http: StoryTools["http"],
  auth: Record<string, string>,
  job: string,
): Promise<string> {
  const r = await http("/api/quotes", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      summary: job,
      jobName: job,
      lineItems: [{ description: job, quantity: 1, unit: "job", price: CENTS }],
      estimatedTotal: CENTS,
      status: "draft",
    }),
  });
  const q = await r.json();
  if (!r.ok || !q?.id) throw new Error(`seed quote: ${JSON.stringify(q)}`);
  await (await http(`/api/quotes/${q.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ status: "sent" }),
  })).body?.cancel();
  return q.id as string;
}

Deno.test("REQ-1085 q3-10: a $6,450.50 quote reads $6,450.50 — never $6,451 — on /quotes' Decided row and its open card", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const wonJob = `Deck rebuild ${digits()}`;
    const openJob = `Porch rebuild ${digits()}`;
    const wonId = await sentQuote(http, auth, wonJob);
    await sentQuote(http, auth, openJob);
    const acc = await http(`/api/quotes/${wonId}/accept`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: "Ann Lee",
        signature: "data:image/png;base64,iVBORw0KGgo=",
      }),
    });
    if (!acc.ok) throw new Error(`accept: ${acc.status} ${await acc.text()}`);
    await acc.body?.cancel();
    const api = await (await http(`/api/quotes/${wonId}`, { headers: auth }))
      .json();
    expect.eq(
      api.estimatedTotal,
      CENTS,
      "the API holds the won quote at 645050 cents",
    );

    await page.goto("/quotes");
    const decided = page.locator(".qtrack", {
      has: page.locator(".qtrack__title", { hasText: "Decided this month" }),
    }).locator(".qdone", { hasText: wonJob }).first();
    await decided.waitFor({ timeout: 20_000 });
    const card = page.locator(".qcard", { hasText: openJob }).first();
    await card.waitFor({ timeout: 20_000 });
    // both readings in one evaluate, so one run reports them together
    const read = await page.evaluate(
      ({ wonJob, openJob }) => {
        const row = [...document.querySelectorAll(".qdone")].find((e) =>
          (e as HTMLElement).innerText.includes(wonJob)
        );
        const c = [...document.querySelectorAll(".qcard")].find((e) =>
          (e as HTMLElement).innerText.includes(openJob)
        );
        const txt = (el: Element | null | undefined) =>
          ((el as HTMLElement | null)?.innerText ?? "").trim();
        return {
          decided: txt(row?.querySelector(".qdone__amt")),
          card: txt(c?.querySelector(".qcard__val-num")),
        };
      },
      { wonJob, openJob },
    );
    expect.eq(
      JSON.stringify(read),
      JSON.stringify({ decided: EXACT, card: EXACT }),
      "the Decided row and the open quote card show the quote to the cent",
    );
  }));
