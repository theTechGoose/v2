/**
 * REQ-687 — demo-loop cycle 5 (run r37f88707), issues m59 ("Contractor's view
 * of her signed quote thanks her as the client") and p14 ("Sticky 'You're
 * previewing as' bar covers '05 SIGN HERE'").
 *
 * m59: the owner opens her own quote after the customer signed it. The top
 * banner says "Signed by Linda Park on … — you're viewing the customer's
 * copy" with an owner next step; the customer's own view still says
 * "Thanks, Linda Park".
 * p14: on the owner's preview of an open quote, scrolling the SIGN HERE
 * section to the top collapses the sticky banner to a one-line strip that
 * sits above the section's header, not over it.
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
    body: JSON.stringify({ language: lang, name: "Owner Signed Story" }),
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

const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

async function sentQuote(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<string> {
  const customer = await post(http, auth, "/api/customers", {
    name: "Linda Park",
    email: "linda@blackhole.postmarkapp.com",
  });
  const quote = await post(http, auth, "/api/quotes", {
    customerId: customer.id,
    summary: "Living room painting",
    jobName: "Living room painting",
    lineItems: [{
      description: "Living room painting",
      quantity: 1,
      unit: "job",
      price: 145000,
    }],
    estimatedTotal: 145000,
    terms: [{ stepId: "payment_terms", value: "Due Now" }],
    status: "draft",
  });
  const sent = await http(`/api/quotes/${quote.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ status: "sent" }),
  });
  await sent.body?.cancel();
  return quote.id as string;
}

Deno.test("REQ-687 (demo m59, cycle 5): the owner's view of her signed quote says who signed and that it is the customer's copy; the customer still gets the thank-you", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const quoteId = await sentQuote(http, auth);
    // the customer signs on their own device (no session)
    const accept = await http(`/api/quotes/${quoteId}/accept`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Linda Park", signature: SIGNATURE_PNG }),
    });
    await accept.body?.cancel();
    if (accept.status >= 400) throw new Error(`accept: ${accept.status}`);

    await page.goto(`/q/${quoteId}`);
    const banner = page.locator("[data-cy='quote-signed-banner']");
    await banner.waitFor({ timeout: 15_000 });
    expect.eq(
      await banner.getAttribute("data-viewer"),
      "owner",
      "the owner's banner",
    );
    const text = (await banner.textContent()) ?? "";
    expect.eq(/Signed by Linda Park/.test(text), true, `names Linda: ${text}`);
    expect.eq(
      /customer's copy/.test(text),
      true,
      `says it is the customer's copy: ${text}`,
    );
    expect.eq(/Thanks,/.test(text), false, `no thank-you: ${text}`);
    expect.eq(
      /your contractor will be in touch/.test(text),
      false,
      `no "your contractor": ${text}`,
    );
    const next = banner.locator("[data-cy='quote-signed-banner-owner-next']");
    expect.eq(await next.count(), 1, "an owner next step");
    expect.eq(
      /^\/(invoices|quotes)\?open=/.test(
        (await next.getAttribute("href")) ?? "",
      ),
      true,
      `points into the app: ${await next.getAttribute("href")}`,
    );

    // the customer (no session) keeps the thank-you
    await page.context().clearCookies();
    await page.goto(`/q/${quoteId}`);
    await banner.waitFor({ timeout: 15_000 });
    expect.eq(
      await banner.getAttribute("data-viewer"),
      "customer",
      "the customer's banner",
    );
    expect.eq(
      /Thanks, Linda Park/.test((await banner.textContent()) ?? ""),
      true,
      "the customer is thanked",
    );
  }));

Deno.test("REQ-687 (demo p14, cycle 5): scrolling SIGN HERE to the top collapses the sticky preview banner to a strip above the header, not over it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const quoteId = await sentQuote(http, auth);
    await page.goto(`/q/${quoteId}`);
    const marker = page.locator("[data-cy='quote-internal-preview']");
    await marker.waitFor({ timeout: 15_000 });
    const banner = page.locator("[data-cy='quote-preview-banner']");
    const tall = await banner.boundingBox();

    // jump the SIGN HERE section to the top, as an anchor / scrollIntoView does
    const pollCompact = async () => {
      for (let i = 0; i < 25; i++) {
        await page.evaluate(() =>
          document.querySelector("[data-cy='quote-internal-preview']")
            ?.closest("section")?.scrollIntoView({ block: "start" })
        );
        if ((await banner.getAttribute("data-compact")) === "true") return;
        await page.waitForTimeout(200);
      }
    };
    await pollCompact();
    expect.eq(
      await banner.getAttribute("data-compact"),
      "true",
      "the banner collapses once scrolled",
    );
    await page.waitForTimeout(300);
    const strip = await banner.boundingBox();
    expect.eq(
      !!strip && strip.y >= -1 && strip.height <= 60 &&
        (!tall || strip.height < tall.height),
      true,
      `a one-line strip at the top (${JSON.stringify(strip)} vs ${
        JSON.stringify(tall)
      })`,
    );
    const header = await page.evaluate(() => {
      const s = document.querySelector("[data-cy='quote-internal-preview']")
        ?.closest("section");
      const r = s?.getBoundingClientRect();
      return r ? { top: r.top, text: s!.textContent!.slice(0, 40) } : null;
    });
    expect.eq(
      !!header && !!strip && strip.y + strip.height <= header.top + 1,
      true,
      `the SIGN HERE header sits below the strip (strip ${
        JSON.stringify(strip)
      }, header ${JSON.stringify(header)})`,
    );
    const text = (await banner.textContent()) ?? "";
    expect.eq(/Linda Park/.test(text), true, `still names Linda: ${text}`);
    expect.eq(
      await banner.locator("[data-cy='quote-preview-sign-in-person']").count(),
      1,
      "Sign in person stays on the strip",
    );
  }));
