/**
 * REQ-248 — demo issue quote-invoice-money-m9: a revision gives notice and a
 * comparison, and version 1 names who published it.
 *
 * A sent Q-001 for $1,000.00; its total is edited to $1,200.00 (a pending
 * revision); a send publishes it. The quote panel's version history then
 * reads "Version 1 · published … by Revision Story" — never an anonymous
 * version — and Version 2 says what changed: "Total $1,000.00 → $1,200.00".
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Revision Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

async function call(
  http: StoryTools["http"],
  auth: Record<string, string>,
  method: string,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method,
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

Deno.test("REQ-248: a published revision shows who published each version and what changed — 'Total $1,000.00 → $1,200.00' — and Version 1 is never anonymous", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await call(http, auth, "POST", "/api/customers", {
      name: "Hans Hansen",
      email: "hans@blackhole.postmarkapp.com",
      address: "725 Frederick Rd, Rockingham, VA",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: customer.id,
      summary: "Deck rebuild — Hans Hansen",
      jobName: "Deck rebuild",
      lineItems: [{
        description: "Deck rebuild",
        quantity: 1,
        unit: "job",
        price: 100000,
      }],
      estimatedTotal: 100000,
      status: "draft",
    });
    const issued = await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    expect(
      issued.publishedBy && issued.publishedBy.userId,
      "the first issue stamps version 1's publisher",
    );
    const pending = await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      estimatedTotal: 120000,
    });
    expect.eq(
      pending.pendingRevision?.estimatedTotal,
      120000,
      "the edit waits as a pending revision",
    );
    const published = await call(
      http,
      auth,
      "POST",
      `/api/quotes/${quote.id}/publish`,
      { notify: false },
    );
    expect.eq(published.version, 2, "publishing makes Version 2");

    await page.goto(`/quotes?open=${quote.id}`);
    const history = page.locator("[data-cy='quote-versions']");
    await history.waitFor({ timeout: 15_000 });
    await history.locator("summary").click();
    await expect.see("Version history (2)");
    const items = history.locator("li");
    expect.eq(await items.count(), 2, "two versions listed");
    const v1 = (await items.nth(0).innerText()).trim();
    expect(
      /^Version 1 · published .+ by Revision Story/.test(v1),
      `version 1 names its publisher: "${v1}"`,
    );
    const v2 = (await items.nth(1).innerText()).trim();
    expect(
      /by Revision Story/.test(v2),
      `version 2 names its publisher: "${v2}"`,
    );
    const changes = history.locator("[data-cy='quote-version-changes']");
    expect.eq(await changes.count(), 1, "only Version 2 has a comparison");
    expect.eq(
      (await changes.first().innerText()).trim(),
      "Total $1,000.00 → $1,200.00",
      "Version 2 says what changed",
    );
  }));
