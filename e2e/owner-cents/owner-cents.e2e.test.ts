/**
 * REQ-961 (LOOP-007 cycle 1, issue q1-35) — Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it green."
 *
 * A $2,489.75 invoice ($2,400 − $100 + 8.25% tax) reads "$2,489.75" on the
 * customer's /i/<id>. The owner's /invoices card, the dashboard money bar
 * ("Money owed to you" and the invoice's row) and the /payments card of the
 * payment that cleared a second, identical invoice printed "$2,490": they used
 * the no-cents KPI formatter on a single document's amount.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const CENTS = 248_975; // (240000 − 10000) × 1.0825 = 248975
const EXACT = "$2,489.75";
const ROUNDED = /\$2,490(?![\d.])/;

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
  await answerQuestions(http, auth, { name: "Cents Story" });
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

async function invoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customerId: string,
  job: string,
): Promise<string> {
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const inv = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId,
      jobName: job,
      status: "sent",
      dueDate: due,
      lineItems: [{ description: job, quantity: 1, unit: "job", price: CENTS }],
      amount: CENTS,
    }),
  })).json();
  if (!inv?.id) throw new Error(`seed invoice: ${JSON.stringify(inv)}`);
  return inv.id as string;
}

Deno.test("REQ-961 q1-35: a $2,489.75 invoice reads $2,489.75 — never $2,490 — on /invoices' card, the money bar and /payments, as on /i/<id>", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Ann Lee", email: "ann@example.test" }),
    })).json();
    const openJob = `Deck rebuild ${digits()}`;
    const paidJob = `Porch rebuild ${digits()}`;
    const openId = await invoice(http, auth, customer.id, openJob);
    const paidId = await invoice(http, auth, customer.id, paidJob);
    const api = await (await http(`/api/invoices/${openId}`, { headers: auth }))
      .json();
    expect.eq(api.amount, CENTS, "the API holds the invoice at 248975 cents");
    const pay = await http("/api/payments", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        invoiceId: paidId,
        amount: CENTS,
        method: "check",
        receivedAt: new Date().toISOString(),
      }),
    });
    if (!pay.ok) {
      throw new Error(`seed payment: ${pay.status} ${await pay.text()}`);
    }
    await pay.body?.cancel();

    // the customer's view — the reference every owner screen must match
    await page.goto(`/i/${openId}`);
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      EXACT,
      { timeout: 20_000 },
    );

    // /invoices — the open invoice's card title
    await page.goto("/invoices");
    const card = page.locator("article.qcard", {
      has: page.locator("[data-cy='invoice-card-job']", { hasText: openJob }),
    }).first();
    await card.waitFor({ timeout: 20_000 });
    const title = (await card.locator(".qcard__title").innerText()).trim();

    // dashboard money bar — "Money owed to you" (after the ticker settles) and the invoice's row
    await page.goto("/dashboard");
    const owed = page.locator("[data-cy='money-owed']");
    await owed.waitFor({ timeout: 20_000 });
    let owedText = "";
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(250);
      const now = (await owed.innerText()).trim();
      if (now === owedText && now !== "$0") break;
      owedText = now;
    }
    const row = page.locator(`[data-cy='money-row'][data-id='${openId}']`);
    await page.locator("[data-cy='money-col'][data-bucket='open']").click();
    await row.waitFor({ timeout: 10_000 });
    const rowAmt = (await row.locator(".moneybar__row-amt").innerText()).trim();

    // /payments — the check that cleared the identical invoice
    await page.goto("/payments");
    const payCard = page.locator("[data-cy='payment-card']").first();
    await payCard.waitFor({ timeout: 20_000 });
    const payAmt = (await payCard.locator(".pcard__amount").innerText()).trim();
    const body = await page.locator("main, body").first().innerText();
    // every reading first, so one run reports them all
    expect.eq(
      JSON.stringify({
        card: title,
        owed: owedText,
        row: rowAmt,
        payment: payAmt,
      }),
      JSON.stringify({ card: EXACT, owed: EXACT, row: EXACT, payment: EXACT }),
      "the /invoices card title, the money bar's owed headline and row, and the /payments card all show the invoice to the cent",
    );
    expect.eq(
      ROUNDED.test(body),
      false,
      `nothing on /payments rounds it to $2,490 (${
        body.match(/\$[\d,.]+/g)?.join(" ")
      })`,
    );
  }));
