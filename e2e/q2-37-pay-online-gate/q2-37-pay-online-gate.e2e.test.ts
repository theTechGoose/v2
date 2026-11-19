/**
 * REQ-1054 (LOOP-007 cycle 2, q2-37) — "Signed email and /q say 'pay online'
 * but /i says to contact the contractor (no online payment set up)".
 *
 * A business with no payment methods and no Stripe/Square: the customer signs.
 * /i shows "Reach out to your contractor to coordinate payment"
 * (data-cy=claim-no-methods), so the signed /q must not offer "Pay now" or
 * "Next: pay the … due". Once the business adds Venmo, /q says "Pay now" and
 * /i offers a way to pay.
 */
import { story, type StoryTools } from "#shots";

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
    body: JSON.stringify({ language: "en", name: "Pay Online Gate Story" }),
  })).body?.cancel();
  // a fresh business with NO payment methods (and no Stripe / Square)
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Northside Builders" }),
  })).body?.cancel();
  // the browser is the CUSTOMER's — only a language pick, no owner session
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].map((domain) => ({
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    })),
  );
  return { auth };
}

async function call(
  http: StoryTools["http"],
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

Deno.test("REQ-1054 (LOOP-007 q2-37): no online pay way — the signed /q offers no 'Pay now' while /i says contact the contractor; after adding Venmo both offer payment", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await call(http, "POST", "/api/customers", auth, {
      name: "Dana Whitfield",
      email: "dana@blackhole.postmarkapp.com",
    });
    const quote = await call(http, "POST", "/api/quotes", auth, {
      customerId: customer.id,
      summary: "Kitchen remodel",
      jobName: "Kitchen remodel",
      lineItems: [{
        description: "Kitchen remodel",
        quantity: 1,
        unit: "job",
        price: 252000,
      }],
      estimatedTotal: 252000,
      status: "draft",
    });
    await call(http, "PUT", `/api/quotes/${quote.id}`, auth, {
      status: "sent",
    });
    await call(http, "POST", `/api/quotes/${quote.id}/accept`, JSON_HEADERS, {
      name: "Dana Whitfield",
      signature: "data:image/png;base64,iVBORw0KGgo=",
    });
    const invoices = await call(http, "GET", "/api/invoices", auth);
    const billed = invoices.filter((i: { quoteId?: string }) =>
      i.quoteId === quote.id
    );
    expect.eq(billed.length, 1, "the signature billed one invoice");
    const invId = billed[0].id as string;

    // ── /i: the contact-your-contractor fallback ──
    await page.goto(`/i/${invId}`);
    const noMethods = page.locator("[data-cy='claim-no-methods']");
    await noMethods.waitFor({ timeout: 15_000 });
    expect.eq(
      /contractor/i.test(await noMethods.innerText()),
      true,
      "/i tells the customer to contact the contractor",
    );

    // ── /q: must not promise online payment ──
    await page.goto(`/q/${quote.id}`);
    const payBtn = page.locator("[data-cy='quote-pay-now']");
    await page.locator("[data-cy='quote-signed-banner']").waitFor({
      timeout: 15_000,
    });
    const btnText = (await payBtn.count())
      ? norm(await payBtn.innerText())
      : "";
    expect.eq(
      /pay now/i.test(btnText),
      false,
      `/i says "contact your contractor", yet /q's button reads "${btnText}"`,
    );
    const bannerPay = page.locator("[data-cy='quote-signed-banner-pay']");
    const bannerText = (await bannerPay.count())
      ? norm(await bannerPay.innerText())
      : "";
    expect.eq(
      /\bpay\b/i.test(bannerText),
      false,
      `no online way to pay, yet /q's banner reads "${bannerText}"`,
    );

    // ── the business adds Venmo: both surfaces offer payment ──
    await call(http, "PUT", "/api/profile/identity", auth, {
      businessName: "Northside Builders",
      acceptedPaymentMethods: {
        venmo: { enabled: true, handle: "@northside" },
      },
    });
    await page.goto(`/i/${invId}`);
    await page.locator("[data-cy='public-invoice-total'], main").first()
      .waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    expect.eq(
      await page.locator("[data-cy='claim-no-methods']").count(),
      0,
      "/i offers Venmo, not the contact fallback",
    );
    await page.goto(`/q/${quote.id}`);
    await payBtn.waitFor({ timeout: 15_000 });
    const btnAfter = norm(await payBtn.innerText());
    expect.eq(
      /pay now/i.test(btnAfter) && btnAfter.includes("$2,520.00"),
      true,
      `Venmo is set up, so /q says "Pay now $2,520.00" (got "${btnAfter}")`,
    );
  }));
