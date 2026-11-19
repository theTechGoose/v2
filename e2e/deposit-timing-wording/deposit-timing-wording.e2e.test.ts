/**
 * REQ-1048 (LOOP-007 cycle 2, q2-32) — "Deposit timing contradicts itself:
 * '30% upfront' vs 'Due a week after signing' vs 'pay now'". The customer
 * opens a "Deposit 30% + balance" quote on /q: before signing the schedule's
 * deposit row says "Due a week after signing" (REQ-954). They sign; the
 * schedule's deposit row now names the deposit invoice's stored due date
 * ("Due Nov 26") — and the thank-you banner's next step must name that SAME
 * date, not an undated "Next: pay the $2,520.00 due →" that reads as "now".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
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
    body: JSON.stringify({ language: lang, name: "Signed Next Step Story" }),
  });
  await me.body?.cancel();
  // The browser is the CUSTOMER's: only their pm_lang pick, never the
  // owner's session (the owner gets a preview with no sign form, REQ-306).
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
  return { auth };
}

async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
    } catch {
      // not clickable yet (hydrating) or gone: the polls below decide
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

Deno.test("REQ-1048 (LOOP-007 q2-32): a signed Deposit 30% + balance quote — the banner's next step names the same deposit due date as the schedule row and the invoice", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const customer = await post(http, auth, "/api/customers", {
      name: "Dana Whitfield",
      email: "dana@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Kitchen remodel",
      jobName: "Kitchen remodel",
      lineItems: [{
        description: "Kitchen remodel",
        quantity: 1,
        unit: "job",
        price: 840000,
      }],
      estimatedTotal: 840000,
      terms: [{
        stepId: "payment_terms",
        label: "Payment",
        value: "Deposit 30% + balance",
      }],
      status: "draft",
    });
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    });
    await sent.body?.cancel();

    await page.goto(`/q/${quote.id}`);
    const form = page.locator("form.ctr__sign-form");
    await form.waitFor({ timeout: 15_000 });
    const depositRow = async () => {
      const cards = await page.locator(".ctr__milestones > div")
        .allInnerTexts();
      return (cards.find((c) => /deposit/i.test(c)) ?? "").replace(/\s+/g, " ");
    };
    const before = await depositRow();
    expect.eq(
      before.includes("Due a week after signing"),
      true,
      `before signing the deposit row says "Due a week after signing": "${before}"`,
    );

    await form.locator("input[type='text']").fill("Dana Whitfield");
    await clickUntil(
      page,
      "form.ctr__sign-form button[type='submit']",
      async () =>
        (await page.locator("[data-cy='quote-signed-banner-pay']").count()) > 0,
    );

    const pub = await (await http(`/api/quotes/${quote.id}/public`)).json();
    const due: string | undefined = pub.invoices?.[0]?.dueDate;
    expect.eq(typeof due, "string", "the signature billed a dated deposit");
    // "2026-11-26" → "Nov 26", the schedule's own short form
    const short = new Date(`${due}T12:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const after = await depositRow();
    expect.eq(
      after.includes(short),
      true,
      `after signing the deposit row names the invoice's due date ${short}: "${after}"`,
    );
    const next = (await page.locator("[data-cy='quote-signed-banner-pay']")
      .innerText()).replace(/\s+/g, " ");
    expect.eq(
      next.includes(short),
      true,
      `the banner's next step names the same deposit due date ${short} as the schedule ("${after}"); it says "${next}"`,
    );
  }));
