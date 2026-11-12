/**
 * REQ-473 — demo-loop cycle 3, issue M8: the dashboard read "MONEY OWED TO
 * YOU $-0 — No invoices yet" and the job row "Deposit · No due date" on an
 * account with a signed "Payment upon completion" job whose deposit invoice
 * was paid and whose one remaining bill was a SCHEDULED installment.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  }
  return await r.json();
}

/** A signed "Payment upon completion" job for Rosa Martinez whose only
 *  remaining bill is a scheduled $925 installment — with (`paidFirst`) or
 *  without a paid $925 invoice before it. Returns the installment's day. */
async function seed(
  http: StoryTools["http"],
  auth: Record<string, string>,
  paidFirst: boolean,
): Promise<string> {
  await answerQuestions(http, auth, {
    name: "Money Owed Story",
    businessName: "Money Owed LLC",
  });
  const customer = await call(http, auth, "POST", "/api/customers", {
    name: "Rosa Martinez",
    email: "rosa@blackhole.postmarkapp.com",
  });
  const line = {
    description: "Bathroom door repair",
    quantity: 1,
    unit: "job",
    price: 92_500,
  };
  const quote = await call(http, auth, "POST", "/api/quotes", {
    customerId: customer.id,
    summary: "Bathroom door repair — Rosa Martinez",
    jobName: "Bathroom door",
    lineItems: [line],
    estimatedTotal: paidFirst ? 185_000 : 92_500,
    status: "draft",
    terms: [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "Payment upon completion",
    }],
  });
  await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  // Drop whatever accept billed so the account holds exactly the demo's bills.
  for (const inv of await call(http, auth, "GET", "/api/invoices")) {
    await call(http, auth, "DELETE", `/api/invoices/${inv.id}`);
  }
  if (paidFirst) {
    await call(http, auth, "POST", "/api/invoices", {
      quoteId: quote.id,
      customerId: customer.id,
      status: "paid",
      paidAt: new Date().toISOString(),
      jobName: "Bathroom door",
      dueDate: inDays(0),
      lineItems: [line],
      amount: 92_500,
    });
  }
  const scheduled = inDays(14);
  await call(http, auth, "POST", "/api/invoices", {
    quoteId: quote.id,
    customerId: customer.id,
    status: "scheduled",
    scheduledFor: scheduled,
    jobName: "Bathroom door",
    dueDate: inDays(44),
    lineItems: [line],
    amount: 92_500,
  });
  return scheduled;
}

/** The dashboard's money panel text once the upcoming line has rendered, and
 *  the Active jobs panel's text. */
async function readDashboard(page: StoryTools["page"]) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard");
  const money = page.locator(".money");
  await money.waitFor({ timeout: 20_000 });
  let text = "";
  for (let i = 0; i < 75; i++) {
    text = (await money.innerText()).replace(/\s+/g, " ").trim();
    if (/Upcoming/i.test(text)) break;
    await page.waitForTimeout(200);
  }
  const job = page.locator(".job").first();
  await job.waitFor({ timeout: 20_000 });
  const jobText = (await job.innerText()).replace(/\s+/g, " ").trim();
  return { money: text, job: jobText };
}

function upcomingText(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const month = d.toLocaleString("en-US", { month: "short" });
  return `Upcoming: $925 bills ${month} ${d.getDate()}`;
}

Deno.test("REQ-473 (demo M8, fleet-0): a paid invoice + a scheduled $925 installment → 'Upcoming: $925 bills …', never '$-0' or 'No invoices yet'; the job row has a due date", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const scheduled = await seed(http, auth, true);
    const { money, job } = await readDashboard(page);
    expect(
      money.includes(upcomingText(scheduled)),
      `the money panel shows the upcoming installment (${money})`,
    );
    expect(!/No invoices yet/i.test(money), `no 'No invoices yet' (${money})`);
    expect(!money.includes("-0"), `no '$-0' (${money})`);
    expect(job.includes("$925 paid"), `the job row reads '$925 paid' (${job})`);
    expect(!job.includes("No due date"), `the job row has a due date (${job})`);
  }));

Deno.test("REQ-473 (demo M8, fleet-1): a 'Payment upon completion' job with nothing paid reads 'Due on completion' with a due date — never 'Deposit · No due date'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const scheduled = await seed(http, auth, false);
    const { money, job } = await readDashboard(page);
    expect(
      job.includes("Due on completion"),
      `the job row reads 'Due on completion' (${job})`,
    );
    expect(
      !/\bDeposit\b/.test(job),
      `the job row does not say 'Deposit' (${job})`,
    );
    expect(!job.includes("No due date"), `the job row has a due date (${job})`);
    expect(
      money.includes(upcomingText(scheduled)),
      `the money panel shows the upcoming installment (${money})`,
    );
    expect(!/No invoices yet/i.test(money), `no 'No invoices yet' (${money})`);
  }));
