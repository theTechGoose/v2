/**
 * REQ-928 — Raphael, 2026-11-18: "when an invoice is paid, it should show the
 * method of payment and when it was paid in all views. print electronic or
 * other."
 *
 * One sent invoice, paid by Venmo on Nov 11 (POST /payments, the same route
 * "Record payment" uses): the /invoices card and its detail, the customer's
 * /i/:id, and the /payments card all say "Electronic (Venmo)" with the date.
 * A second invoice paid by check says "Other (Check)".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Paid Story" }),
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

async function paidInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customerId: string,
  job: string,
  method: string,
  receivedAt: string,
) {
  const inv = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId,
      jobName: job,
      status: "sent",
      lineItems: [{ description: job, quantity: 1, unit: "job", price: 32000 }],
      amount: 32000,
    }),
  })).json();
  if (!inv?.id) throw new Error(`seed invoice: ${JSON.stringify(inv)}`);
  const pay = await http("/api/payments", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      invoiceId: inv.id,
      amount: 32000,
      method,
      receivedAt,
    }),
  });
  if (!pay.ok) {
    throw new Error(`seed payment: ${pay.status} ${await pay.text()}`);
  }
  await pay.body?.cancel();
  return inv.id as string;
}

function card(page: StoryTools["page"], jobName: string) {
  return page.locator("article.qcard", {
    has: page.locator("[data-cy='invoice-card-job']", { hasText: jobName }),
  }).first();
}

Deno.test("REQ-928: a paid invoice says when and how it was paid — Electronic or Other — on /invoices, its detail, /i and /payments", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Walter Pruitt",
        email: "walter@example.test",
      }),
    })).json();
    // paid this month so the card is in "Paid this month"
    const now = new Date();
    const day = (d: number) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, 15))
        .toISOString();
    const paidDay = Math.max(1, now.getUTCDate() - 1);
    const venmoJob = `Fence stain ${digits()}`;
    const checkJob = `Gutter clean ${digits()}`;
    const venmoId = await paidInvoice(
      http,
      auth,
      customer.id,
      venmoJob,
      "venmo",
      day(paidDay),
    );
    const checkId = await paidInvoice(
      http,
      auth,
      customer.id,
      checkJob,
      "check",
      day(paidDay),
    );

    const api =
      await (await http(`/api/invoices/${venmoId}`, { headers: auth })).json();
    expect.eq(
      JSON.stringify(api.paidMethods),
      JSON.stringify(["venmo"]),
      "the API records how it was paid",
    );
    expect.eq(api.status, "paid", "and that it is paid");

    // /invoices — open the "Paid this month" track
    await page.goto("/invoices");
    await page.evaluate(() =>
      localStorage.setItem("invoices:track:04", "open")
    );
    await page.reload();
    const venmoCard = card(page, venmoJob);
    await venmoCard.waitFor({ timeout: 20_000 });
    const cardText = await venmoCard.locator(".qcard__story").innerText();
    expect.eq(
      /Paid .+ · Electronic \(Venmo\)/.test(cardText),
      true,
      `the card says how: ${cardText}`,
    );
    const checkText = await card(page, checkJob).locator(".qcard__story")
      .innerText();
    expect.eq(
      /Paid .+ · Other \(Check\)/.test(checkText),
      true,
      `a check reads Other: ${checkText}`,
    );

    // the detail
    const longDate = new Date(day(paidDay)).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    await page.goto(`/invoices?open=${venmoId}`);
    const detail = page.locator("[data-cy='invoice-paid-how']");
    await detail.waitFor({ timeout: 20_000 });
    expect.eq(
      (await detail.innerText()).trim(),
      `Paid ${longDate} · Electronic (Venmo)`,
      "the detail says when and how",
    );

    // the customer's page
    await page.goto(`/i/${checkId}`);
    const pub = page.locator("[data-cy='public-invoice-paid-how']");
    await pub.waitFor({ timeout: 20_000 });
    expect.eq(
      (await pub.innerText()).trim(),
      `Paid ${longDate} · Other (Check)`,
      "/i says when and how",
    );

    // /payments — the landed payment's card names Electronic / Other
    await page.goto("/payments");
    const payCard = page.locator("[data-cy='payment-card']", {
      hasText: "Electronic (Venmo)",
    }).first();
    await payCard.waitFor({ timeout: 20_000 });
    expect.eq(
      await page.locator("[data-cy='payment-card']", {
        hasText: "Other (Check)",
      }).count() > 0,
      true,
      "the check payment's card says Other (Check)",
    );
  }));
