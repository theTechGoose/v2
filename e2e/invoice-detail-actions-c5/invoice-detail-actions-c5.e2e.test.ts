/**
 * REQ-702 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue m21: "Invoice detail lacks
 * customer name/number and has no link or 'send now'". RCA CONFIRMED /
 * skeptic UPHELD at 2444608a.
 *
 * In a browser:
 * (a) the flipped card's back names the customer and the invoice number
 *     under the amount;
 * (b) a scheduled invoice opened in the detail panel (/invoices?open=<id>)
 *     carries "Send now", "View as customer" (→ /i/<id>) and "Copy link";
 *     Send now sends it in place — the panel's action turns into
 *     "Send reminder" for the now-sent invoice, no page load.
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
    body: JSON.stringify({ language: "en", name: "Detail Actions Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  url: string,
  body: unknown,
) {
  const r = await http(url, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

Deno.test("REQ-702 (demo m21, cycle 5): the flipped card's back names the customer and the invoice number", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Marisol Ortega",
      email: "mo@blackhole.postmarkapp.com",
    });
    const job = `Deck sealing ${digits()}`;
    await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: job,
      lineItems: [{ description: job, quantity: 1, unit: "job", price: 28000 }],
      amount: 28000,
      status: "scheduled",
      scheduledFor: inDays(7),
      dueDate: inDays(37),
      netDays: 30,
    });

    // (a) the card back
    await page.goto("/invoices");
    const card = page.locator("article.qcard", {
      has: page.locator("[data-cy='invoice-card-job']", { hasText: job }),
    }).first();
    const who = card.locator("[data-cy='invoice-card-back-who']");
    await who.waitFor({ state: "attached", timeout: 15_000 });
    const whoText = (await who.textContent())?.trim() ?? "";
    expect(
      whoText.startsWith("Marisol Ortega · ") && /INV-\d+/.test(whoText),
      `card back: customer · number (${whoText})`,
    );
  }));

Deno.test("REQ-702 (demo m21, cycle 5): a scheduled invoice's detail panel can Send now, View as customer and Copy link — sent in place, it then offers Send reminder", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Marisol Ortega",
      email: "mo@blackhole.postmarkapp.com",
    });
    const job = `Deck sealing ${digits()}`;
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: job,
      lineItems: [{ description: job, quantity: 1, unit: "job", price: 28000 }],
      amount: 28000,
      status: "scheduled",
      scheduledFor: inDays(7),
      dueDate: inDays(37),
      netDays: 30,
    });

    // (b) the detail panel
    await page.goto(`/invoices?open=${inv.id}`);
    const panel = page.locator("[data-cy='invoice-detail']");
    const sendNow = panel.locator("[data-cy='invoice-detail-cta-scheduled']");
    await sendNow.waitFor({ timeout: 15_000 });
    expect.eq((await sendNow.innerText()).trim(), "Send now", "Send now label");
    const open = panel.locator("a[data-cy='invoice-detail-open']");
    expect.eq(
      (await open.getAttribute("href"))?.split("?")[0],
      `/i/${inv.id}`,
      "View as customer opens the customer's page",
    );
    expect(
      await panel.locator("[data-cy='invoice-detail-copy-link']").count() === 1,
      "Copy link is offered",
    );

    await page.waitForLoadState("networkidle").catch(() => {});
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__req702 = "same page";
    });
    // a pre-hydration click is a no-op — click until the send is on its way
    const sent = page.waitForResponse(
      (r) => r.url().includes(`/api/invoices/${inv.id}/email`),
      { timeout: 15_000 },
    );
    await sendNow.click();
    await sent;
    const remind = panel.locator("[data-cy='invoice-detail-cta-out']");
    const moved = await remind.waitFor({ timeout: 15_000 }).then(
      () => true,
      () => false,
    );
    expect(moved, "the sent invoice's panel now offers Send reminder");
    expect.eq((await remind.innerText()).trim(), "Send reminder", "label");
    expect.eq(
      await page.evaluate(() =>
        (globalThis as Record<string, unknown>).__req702 ?? null
      ),
      "same page",
      "no page load",
    );
  }));
