/**
 * REQ-396 — demo-loop cycle 2, issue M13: "Open staff panel and customer /q
 * pages don't refresh status after sign/publish". In a browser, with NO
 * reload by the test:
 *  - the contractor has Q open in the /quotes panel (badge "Sent"); the
 *    customer signs on their own device; the panel turns "Accepted" on the
 *    list's next re-read (the window's focus) — fleet-4 :294;
 *  - the customer has /q/:id open in one tab and signs in another; the open
 *    tab shows the signed document on its own (10 s poll).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** an owner session over HTTP; `page` (if given) gets the cookie too */
async function signIn(
  http: StoryTools["http"],
  baseUrl: string,
  page?: StoryTools["page"],
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
    body: JSON.stringify({ language: "en", name: "Live Doc Story" }),
  });
  await me.body?.cancel();
  const identity = await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Live Doc Co" }),
  });
  await identity.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  const cookies = [...hosts].flatMap((domain) => [
    ...(page ? [{ name, value, domain, path: "/" }] : []),
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]);
  return { auth, cookies };
}

async function post(
  http: StoryTools["http"],
  headers: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

async function sentQuote(
  http: StoryTools["http"],
  auth: Record<string, string>,
  jobName: string,
) {
  const customer = await post(http, auth, "/api/customers", {
    name: "Dana Price",
    email: "dana@blackhole.postmarkapp.com",
  });
  const quote = await post(http, auth, "/api/quotes", {
    customerId: customer.id,
    summary: jobName,
    jobName,
    lineItems: [{
      description: jobName,
      quantity: 1,
      unit: "job",
      price: 90000,
    }],
    estimatedTotal: 90000,
    status: "draft",
  });
  const sent = await http(`/api/quotes/${quote.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ status: "sent" }),
  });
  await sent.body?.cancel();
  return quote as { id: string };
}

const accept = (http: StoryTools["http"], id: string) =>
  post(http, JSON_HEADERS, `/api/quotes/${id}/accept`, {
    name: "Dana Price",
    signature: "data:image/png;base64,iVBORw0KGgo=",
  });

Deno.test("REQ-396 M13: the open /quotes panel turns Accepted once the customer signs, without a reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, cookies } = await signIn(http, baseUrl, page);
    await page.context().addCookies(cookies);
    const quote = await sentQuote(http, auth, "Porch rebuild REQ-396");

    await page.goto(`/quotes?open=${quote.id}`);
    const badge = page.locator("[data-cy='quote-status-badge']");
    await badge.waitFor({ timeout: 15_000 });
    expect(
      !/accepted/i.test(await badge.innerText()),
      `the panel opens unsigned (${await badge.innerText()})`,
    );

    // The customer signs on their own device.
    await accept(http, quote.id);

    // The owner comes back to the tab: the list re-reads on focus, and the
    // open panel follows its card.
    await page.evaluate(() => globalThis.dispatchEvent(new Event("focus")));
    await page.locator("[data-cy='quote-status-badge']", {
      hasText: /accepted/i,
    }).waitFor({ timeout: 30_000 });
  }));

Deno.test("REQ-396 M13: the customer's open /q/:id tab shows the signed document once they sign elsewhere, without a reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    // the customer's browser carries no owner session
    const { auth, cookies } = await signIn(http, baseUrl);
    await page.context().addCookies(cookies);
    const quote = await sentQuote(http, auth, "Gutter swap REQ-396");

    await page.goto(`/q/${quote.id}`);
    await page.locator("[data-cy='quote-doc-headline']").waitFor({
      timeout: 15_000,
    });

    // signed on another device / tab
    await accept(http, quote.id);

    const banner = page.locator("[data-cy='quote-signed-banner']");
    await banner.waitFor({ timeout: 30_000 });
    expect(
      /Dana Price/.test(await banner.innerText()),
      `the open tab shows who signed (${await banner.innerText()})`,
    );
  }));
