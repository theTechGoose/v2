/**
 * REQ-926 — Raphael (A2Z in prod, a Paper invoice's payment): "it says its
 * in transit, but there is no way to mark it as delivered." Then: "lets
 * remove the in transit, add to the payment a 'chargeback' button … add a
 * default fee in the settings and a modal when the chargeback is clicked to
 * add a fee with the default populated."
 *
 * Settings → Chargeback fee $35 · a check recorded today is Landed at once
 * (no In transit) · Chargeback → the modal, its fee prefilled 35.00 →
 * Confirm → the card in Charged back, struck through, "+$35.00 fee" · the
 * invoice owes again $250 + $35 · Undo → back to paid.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Chargeback Story" }),
  })).body?.cancel();
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

async function json(
  http: StoryTools["http"],
  url: string,
  init: RequestInit,
) {
  const r = await http(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(body)}`);
  return body;
}

Deno.test("REQ-926: Chargeback on a payment — Settings' fee prefilled in the modal; the payment is kept, struck through; the invoice owes again + the fee; Undo; no In transit", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);

    // Settings → the default fee
    await page.goto("/settings");
    const feeBox = page.locator("[data-cy='settings-chargeback-fee']");
    await feeBox.waitFor({ timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await feeBox.fill("35");
    await feeBox.blur();
    let saved = 0;
    for (let i = 0; i < 20 && saved !== 3500; i++) {
      await page.waitForTimeout(300);
      saved = (await json(http, "/api/profile/identity", { headers: auth }))
        ?.chargebackFeeCents ?? 0;
    }
    expect.eq(saved, 3500, "Settings saved $35 as 3500 cents");

    // a sent invoice, paid today by check
    const customer = await json(http, "/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Walter Pruitt" }),
    });
    const job = `Fence stain ${digits()}`;
    const inv = await json(http, "/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        jobName: job,
        status: "sent",
        lineItems: [{
          description: job,
          quantity: 1,
          unit: "job",
          price: 25000,
        }],
        subtotalCents: 25000,
        amount: 25000,
      }),
    });
    await json(http, "/api/payments", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        invoiceId: inv.id,
        amount: 25000,
        method: "check",
        receivedAt: new Date().toISOString(),
      }),
    });

    await page.goto("/payments");
    const btn = page.locator("[data-cy='pay-card-chargeback']").first();
    await btn.waitFor({ timeout: 20_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    expect.eq(
      await page.locator("[data-cy='payments-kpi-transit']").count(),
      0,
      "no In transit on /payments",
    );
    await expect.see("Landed");

    const modal = page.locator("[data-cy='chargeback-modal']");
    for (let i = 0; i < 20 && !(await modal.count()); i++) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(400);
    }
    await modal.waitFor({ timeout: 10_000 });
    expect.eq(
      await page.locator("[data-cy='chargeback-fee']").inputValue(),
      "35.00",
      "the fee starts on Settings' default",
    );
    await page.locator("[data-cy='chargeback-reason']").fill("Check bounced");
    await page.locator("[data-cy='chargeback-confirm']").click();

    const track = page.locator("[data-cy='payments-reversed-track']");
    await track.waitFor({ timeout: 15_000 });
    await track.locator("[data-cy='pay-card-chargeback-fee']").waitFor();
    expect.eq(
      (await track.locator("[data-cy='pay-card-chargeback-fee']").innerText())
        .trim(),
      "+$35.00 fee on the invoice",
      "the fee is said on the card",
    );
    const struck = await track.locator(".pcard__amount").first().evaluate((
      el,
    ) => getComputedStyle(el).textDecorationLine);
    expect.eq(struck, "line-through", "the amount is crossed out");

    const reopened = await json(http, `/api/invoices/${inv.id}`, {
      headers: auth,
    });
    expect(
      reopened.status !== "paid",
      `the invoice reopened (${reopened.status})`,
    );
    expect.eq(reopened.amount, 28500, "it owes $250 + the $35 fee");
    expect.eq(
      reopened.lineItems.at(-1).description,
      "Chargeback fee",
      "the fee is its own line",
    );

    // Undo
    await track.locator("[data-cy='pay-card-chargeback-undo']").click();
    await page.locator("[data-cy='payments-reversed-track']").waitFor({
      state: "detached",
      timeout: 15_000,
    });
    const back = await json(http, `/api/invoices/${inv.id}`, { headers: auth });
    expect.eq(back.status, "paid", "undo: paid again");
    expect.eq(back.amount, 25000, "undo: no fee");
  }));
