/**
 * REQ-1053 (LOOP-007 cycle 2, issue q2-43) — "A declined quote still offers
 * 'Remaining to invoice $6,450.00' and 'Create next invoice'".
 *
 * A quote is sent, the customer declines it through the public
 * POST /api/quotes/:id/decline (status "lost"), and the contractor opens
 * /quotes?open=<id>: the ledger must not offer "Remaining to invoice" and
 * there must be no live "Create next invoice" link to /invoices?new=1.
 * Extends REQ-686 (the same rule for an unsent draft).
 *
 * Page: /quotes (QuotesPage.tsx → ledgerSummary in shared/documents/linked-view.ts).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Declined Panel User", language: "en" }],
      ["/api/profile/identity", { businessName: "Declined Panel Business" }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
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

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  payload?: unknown,
) {
  const res = await http(path, {
    method: "POST",
    headers: auth,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return await res.json().catch(() => ({}));
}

Deno.test("REQ-1053 (LOOP-007 q2-43): a declined quote's /quotes panel offers no 'Remaining to invoice' and no live 'Create next invoice'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const customer = await post(http, auth, "/api/customers", {
      name: "Dee Decline",
      email: "dee@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Fence install — Dee Decline",
      jobName: "Fence install",
      lineItems: [{
        description: "Fence install",
        quantity: 1,
        unit: "job",
        price: 645000,
      }],
      estimatedTotal: 645000,
      status: "draft",
    });
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        status: "sent",
        sentAt: new Date().toISOString(),
      }),
    });
    await sent.body?.cancel();

    // the customer declines on the public page's endpoint (no session)
    const dec = await http(`/api/quotes/${quote.id}/decline`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: "price", name: "Dee Decline" }),
    });
    expect.eq(dec.status, 200, "the decline landed");
    await dec.body?.cancel();
    const after = await (await http(`/api/quotes/${quote.id}`, {
      headers: auth,
    })).json();
    expect.eq(after.status, "lost", "the declined quote is stored as 'lost'");

    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-open-panel']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='quote-ledger']").waitFor({
      timeout: 15_000,
    });
    // one evaluate: read the correlated facts against one render
    const facts = await page.evaluate(() => {
      const panel = document.querySelector("[data-cy='quote-open-panel']");
      const remaining = document.querySelector("[data-cy='ledger-remaining']");
      const links = [
        ...document.querySelectorAll("a[data-cy='quote-create-next-invoice']"),
      ].map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "");
      return {
        remaining: remaining ? (remaining as HTMLElement).innerText : null,
        remainingText: /Remaining to invoice/i.test(
          (panel as HTMLElement | null)?.innerText ?? "",
        ),
        links,
      };
    });
    expect.eq(
      facts.remaining,
      null,
      `no 'Remaining to invoice' row on a declined quote (got ${
        JSON.stringify(facts.remaining)
      })`,
    );
    expect.eq(
      facts.remainingText,
      false,
      "the panel never says 'Remaining to invoice' on a declined quote",
    );
    expect.eq(
      facts.links.length,
      0,
      `no live 'Create next invoice' link on a declined quote (got ${
        JSON.stringify(facts.links)
      })`,
    );
  }));
