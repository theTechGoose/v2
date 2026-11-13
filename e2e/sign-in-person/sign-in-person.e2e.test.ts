/**
 * REQ-405 — demo-loop cycle 2, issue m14 ("'Sign in person' reloads page,
 * drops scroll to top and ?lang=es"): the business owner previews their own
 * quote, flips it to Spanish, scrolls down to the signature card and taps
 * "Firmar en persona" — the pad appears right there: no reload, no jump to
 * the top, and ?lang=es stays in the URL beside ?as=customer&confirm=1.
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
    body: JSON.stringify({ language: lang, name: "Sign In Person Story" }),
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

Deno.test("REQ-405 (demo m14, cycle 2): 'Sign in person' shows the pad in place — no reload, scroll kept, ?lang=es kept", (t) =>
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

    // the owner's own view: the preview banner, not the pad
    await page.goto(`/q/${quote.id}`);
    const preview = page.locator("[data-cy='quote-internal-preview']");
    await preview.waitFor({ timeout: 15_000 });
    expect.eq(await page.locator("form.ctr__sign-form").count(), 0, "no pad");

    // flip to Spanish AFTER the page loaded (the stale-search case)
    await clickUntil(
      page,
      "[data-contract-lang='es']",
      async () =>
        new URL(page.url()).searchParams.get("lang") === "es" &&
        (await page.locator("[data-contract-lang='es'][aria-pressed='true']")
            .count()) > 0,
    );

    const button = page.locator("[data-cy='quote-sign-in-person']");
    await button.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => globalThis.scrollY);
    expect.eq(
      scrollBefore > 200,
      true,
      `the signature card sits down the page (scrollY ${scrollBefore})`,
    );
    // a marker that only survives if the page is NOT reloaded
    await page.evaluate(() => {
      (globalThis as unknown as { __req405: string }).__req405 = "alive";
    });

    const form = page.locator("form.ctr__sign-form");
    await clickUntil(
      page,
      "[data-cy='quote-sign-in-person']",
      async () => (await form.count()) > 0,
    );
    await page.waitForTimeout(600);

    const marker = await page.evaluate(() =>
      (globalThis as unknown as { __req405?: string }).__req405
    );
    expect.eq(marker, "alive", "the page did not reload");
    const q = new URL(page.url()).searchParams;
    expect.eq(q.get("lang"), "es", `?lang=es kept: ${page.url()}`);
    expect.eq(q.get("as"), "customer", `?as=customer: ${page.url()}`);
    expect.eq(q.get("confirm"), "1", `?confirm=1: ${page.url()}`);
    const scrollAfter = await page.evaluate(() => globalThis.scrollY);
    expect.eq(
      scrollAfter > 200,
      true,
      `the page did not jump to the top (scrollY ${scrollAfter}, was ${scrollBefore})`,
    );
    const padInView = await form.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top < globalThis.innerHeight && r.bottom > 0;
    });
    expect.eq(padInView, true, "the pad is in view where the owner tapped");
    expect.eq(await preview.count(), 0, "the preview banner is gone");
    expect.eq(
      await page.locator("[data-contract-lang='es'][aria-pressed='true']")
        .count(),
      1,
      "still Spanish",
    );
  }));

Deno.test("REQ-560 (demo-loop cycle 4, p4-p2b): signed in person on the owner's device — the note names the customer's copy, never 'check your email'", (t) =>
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
    await page.locator("[data-cy='quote-internal-preview']").waitFor({
      timeout: 15_000,
    });
    const form = page.locator("form.ctr__sign-form");
    await clickUntil(
      page,
      "[data-cy='quote-sign-in-person']",
      async () => (await form.count()) > 0,
    );
    await form.locator("input[type='text']").fill("Ana Pérez");
    const note = page.locator("[data-cy='quote-signed-note']");
    await clickUntil(
      page,
      "form.ctr__sign-form button[type='submit']",
      async () => (await note.count()) > 0,
    );
    const text = (await note.textContent()) ?? "";
    expect.eq(
      /checking your email/i.test(text),
      false,
      `no "check your email" on the owner's device: ${text}`,
    );
    expect.eq(
      text.includes(
        "Signed in person — Ana Pérez gets a copy at ana@blackhole.postmarkapp.com",
      ),
      true,
      `the in-person note: ${text}`,
    );
  }));
