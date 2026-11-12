/**
 * REQ-559 — demo-loop cycle 4, issues m17 ("Owner's preview of client quote
 * page confusing: sign disabled vs prompts, notice only in section 05") and
 * p4-p1c ("'Sign in person' not obvious"): the business owner opens their own
 * sent quote. Right at the top, before scrolling, a banner says they are
 * previewing as the customer and that signing, questions and decline are off,
 * with a solid "Sign in person" button. Ask a question / Decline are disabled.
 * Tapping the banner's button brings up the pad in place.
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
    body: JSON.stringify({ language: lang, name: "Preview Banner Story" }),
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

Deno.test("REQ-559 (demo m17 + p4-p1c, cycle 4): the owner's preview has a top banner with Sign in person, and Ask/Decline are off", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const customer = await post(http, auth, "/api/customers", {
      name: "Linda Park",
      email: "linda@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Deck repair",
      jobName: "Deck repair",
      lineItems: [{
        description: "Deck repair",
        quantity: 1,
        unit: "job",
        price: 250000,
      }],
      estimatedTotal: 250000,
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
    const banner = page.locator("[data-cy='quote-preview-banner']");
    expect.eq(await banner.count(), 1, "a preview banner renders");
    const box = await banner.boundingBox();
    const vh = await page.evaluate(() => globalThis.innerHeight);
    expect.eq(
      !!box && box.y >= 0 && box.y + box.height <= vh,
      true,
      `the banner is on screen without scrolling (${JSON.stringify(box)})`,
    );
    const text = (await banner.textContent()) ?? "";
    expect.eq(text.includes("Linda Park"), true, `names Linda: ${text}`);
    expect.eq(
      /signing, questions and decline are off/.test(text),
      true,
      `says what is off: ${text}`,
    );
    expect.eq(
      /sign and type your name below/i.test(
        (await page.locator("body").textContent()) ?? "",
      ),
      false,
      "no 'sign below' prompt in the preview",
    );
    for (const sel of ["quote-ask", "quote-decline"]) {
      const b = page.locator(`[data-cy='${sel}']`);
      expect.eq(await b.isDisabled(), true, `${sel} is disabled`);
      expect.eq(
        ((await b.getAttribute("title")) ?? "").length > 0,
        true,
        `${sel} explains why`,
      );
    }

    // sticky: still on screen after scrolling down to the signature card
    await page.locator("[data-cy='quote-internal-preview']")
      .scrollIntoViewIfNeeded();
    const stuck = await banner.boundingBox();
    expect.eq(
      !!stuck && stuck.y >= -1 && stuck.y < vh,
      true,
      `the banner stays at the top while scrolling (${JSON.stringify(stuck)})`,
    );

    const form = page.locator("form.ctr__sign-form");
    await clickUntil(
      page,
      "[data-cy='quote-preview-sign-in-person']",
      async () => (await form.count()) > 0,
    );
    expect.eq(await banner.count(), 0, "the banner is gone once signing");
    const q = new URL(page.url()).searchParams;
    expect.eq(q.get("as"), "customer", `?as=customer: ${page.url()}`);
    expect.eq(q.get("confirm"), "1", `?confirm=1: ${page.url()}`);
  }));
