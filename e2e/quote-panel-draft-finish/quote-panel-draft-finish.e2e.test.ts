/**
 * REQ-686 (demo-loop cycle 5, issues m44 + m45) — "Draft quote panel has no
 * Send" and "Send and 'Publish revision…' side by side; history says
 * 'published' on a draft" (pair 5).
 *
 *  1. /quotes?open=<draft>: the panel's primary is "Finish & send" (no
 *     Send ▾), there is no "Remaining to invoice" / "Create next invoice",
 *     the version history reads "Version 1 · draft, not sent", and Finish &
 *     send lands on the quote's own thread /assistant/<id>.
 *  2. /quotes?open=<sent quote with a pending revision>: no header Send ▾ —
 *     "Publish revision and notify customer" is the one primary.
 *
 * Pages: /quotes (QuotesPage.tsx), /assistant/[threadId].
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
      ["/api/me", { name: "Panel User", language: "en" }],
      ["/api/profile/identity", { businessName: "Panel Business" }],
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

/** an island may still be hydrating when its target appears: click until the effect shows */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-686 m44/m45: a draft's panel offers Finish & send (to its thread), nothing to invoice, and 'draft, not sent' history", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const customer = await post(http, auth, "/api/customers", {
      name: "Dana Draft",
      email: "dana@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Kitchen remodel — Dana Draft",
      jobName: "Kitchen remodel",
      lineItems: [{
        description: "Kitchen remodel",
        quantity: 1,
        unit: "job",
        price: 1540000,
      }],
      estimatedTotal: 1540000,
      status: "draft",
    });
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
      customerId: customer.id,
    });

    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-open-panel']").waitFor({
      timeout: 15_000,
    });
    const finish = page.locator("[data-cy='quote-panel-finish']");
    await finish.waitFor({ state: "visible", timeout: 15_000 });
    expect.eq(
      (await finish.innerText()).trim(),
      "Finish & send",
      "the draft's primary reads 'Finish & send'",
    );
    expect.eq(
      await page.locator("[data-cy='quote-panel-send']").count(),
      0,
      "no Send ▾ on a draft",
    );
    await page.locator("[data-cy='quote-ledger']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='ledger-remaining']").count(),
      0,
      "no 'Remaining to invoice' on an unsent draft",
    );
    expect.eq(
      await page.locator("[data-cy='quote-create-next-invoice']").count(),
      0,
      "no 'Create next invoice' on an unsent draft",
    );
    const history = page.locator("[data-cy='quote-versions']");
    await history.locator("summary").click();
    const historyText = await history.innerText();
    expect.eq(
      historyText.includes("Version 1 · draft, not sent"),
      true,
      `the history says 'draft, not sent' (got: ${historyText})`,
    );
    expect.eq(
      /published/i.test(historyText),
      false,
      "the history never says 'published' on a draft",
    );

    await clickUntil(
      page,
      "[data-cy='quote-panel-finish']",
      async () => new URL(page.url()).pathname.startsWith("/assistant/"),
    );
    await page.waitForURL(`**/assistant/${conv.id}`, {
      timeout: 30_000,
      waitUntil: "commit",
    });
    expect.eq(
      new URL(page.url()).pathname,
      `/assistant/${conv.id}`,
      "Finish & send opens the quote's own thread",
    );
  }));

Deno.test("REQ-686 m45: with a revision waiting, 'Publish revision' is the one primary — no header Send ▾", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const customer = await post(http, auth, "/api/customers", {
      name: "Rae Revise",
      email: "rae@blackhole.postmarkapp.com",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Deck stain — Rae Revise",
      jobName: "Deck stain",
      lineItems: [{
        description: "Deck stain",
        quantity: 1,
        unit: "job",
        price: 90000,
      }],
      estimatedTotal: 90000,
      status: "draft",
    });
    for (
      const body of [
        { status: "sent", sentAt: new Date().toISOString() },
        { estimatedTotal: 120000 },
      ]
    ) {
      const r = await http(`/api/quotes/${quote.id}`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify(body),
      });
      await r.body?.cancel();
    }

    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-open-panel']").waitFor({
      timeout: 15_000,
    });
    const publish = page.locator("[data-cy='quote-publish']");
    await publish.waitFor({ state: "visible", timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='quote-panel-send']").count(),
      0,
      "no header Send ▾ while the revision waits",
    );
    expect.eq(
      ((await publish.getAttribute("class")) ?? "").includes(
        "qopen__btn--primary",
      ),
      true,
      "Publish revision is the solid primary",
    );
  }));
