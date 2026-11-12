/**
 * REQ-311 — demo-loop cycle 1, issue m19 ("After signing, page jumps to top
 * with no next step or thank-you"): the customer signs at the bottom of the
 * agreement and the page stays put — no reload, no jump — with the signature
 * card filled in, the "Pay now $X" button in view, and a thank-you banner
 * naming the next step at the top of the document.
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
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
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

Deno.test("REQ-311: signing keeps the customer where they signed — no reload, Pay now in view, and a thank-you banner naming the next step", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const customer = await post(http, auth, "/api/customers", {
      name: "Ana Pérez",
      email: "ana@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Bathroom remodel",
      jobName: "Bathroom remodel",
      lineItems: [{
        description: "Bathroom remodel",
        quantity: 1,
        unit: "job",
        price: 480000,
      }],
      estimatedTotal: 480000,
      terms: [{ stepId: "payment_terms", value: "Due Now" }],
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
    expect.eq(
      await page.locator("[data-cy='quote-signed-banner']").count(),
      0,
      "no thank-you banner before signing",
    );
    // a marker that only survives if the page is NOT reloaded
    await page.evaluate(() => {
      (globalThis as unknown as { __req311: string }).__req311 = "alive";
    });
    await form.locator("input[type='text']").fill("Ana Pérez");
    await form.locator("input[type='text']").scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => globalThis.scrollY);
    expect.eq(
      scrollBefore > 200,
      true,
      `the sign form sits down the page (scrollY ${scrollBefore})`,
    );

    await clickUntil(
      page,
      "form.ctr__sign-form button[type='submit']",
      async () => (await page.locator("[data-cy='quote-pay-now']").count()) > 0,
    );
    await page.waitForTimeout(1_200); // the old code reloaded 900 ms after the accept

    const marker = await page.evaluate(() =>
      (globalThis as unknown as { __req311?: string }).__req311
    );
    expect.eq(marker, "alive", "the page did not reload after signing");
    const scrollAfter = await page.evaluate(() => globalThis.scrollY);
    expect.eq(
      scrollAfter > 200,
      true,
      `the page did not jump to the top (scrollY ${scrollAfter}, was ${scrollBefore})`,
    );
    const payInView = await page.locator("[data-cy='quote-pay-now']").evaluate(
      (el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= globalThis.innerHeight;
      },
    );
    expect.eq(
      payInView,
      true,
      "the Pay now button is inside the viewport where the customer signed",
    );
    await expect.see("Signed and binding");

    const banner = page.locator("[data-cy='quote-signed-banner']");
    expect.eq(await banner.count(), 1, "the thank-you banner is on the page");
    const text = (await banner.innerText()).replace(/\s+/g, " ");
    expect.eq(text.includes("Thanks, Ana Pérez"), true, `banner: ${text}`);
    expect.eq(
      text.includes("$4,800.00"),
      true,
      `banner names the deposit: ${text}`,
    );
    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json();
    const billed = invoices.filter((i: { quoteId?: string }) =>
      i.quoteId === quote.id
    );
    expect.eq(billed.length, 1, "the signature billed one invoice");
    expect.eq(
      await banner.locator("[data-cy='quote-signed-banner-pay']").getAttribute(
        "href",
      ),
      `/i/${billed[0].id}`,
      "the banner's next step links the billed invoice",
    );
  }));
