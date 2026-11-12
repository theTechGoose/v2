/**
 * REQ-551 — demo-loop cycle 4, issue B2: "Payment 10x the invoice accepted
 * with no overpayment check; totals disagree across pages", in a browser on
 * the real shell.
 *
 *   (a) $100 on a $65 invoice asks "This is $35.00 more than the $65.00
 *       owed. Record it anyway?" and sends nothing; "Record anyway" records
 *       it, and /payments counts $65 with the $35 overpaid on its own line
 *   (b) $1,000 on a $65 invoice (over 10x) is refused and sends nothing
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
    body: JSON.stringify({ language: "en", name: "Overpay Story" }),
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

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function sentInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Randall Belknap",
      email: "rb@blackhole.postmarkapp.com",
    }),
  })).json();
  return await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      status: "sent",
      jobName: "Back fence",
      dueDate: inDays(2),
      lineItems: [{
        description: "Back fence",
        quantity: 1,
        unit: "job",
        price: 6500,
      }],
      amount: 6500,
    }),
  })).json();
}

async function openPayForm(page: StoryTools["page"], invId: string) {
  await page.goto(`/invoices?open=${invId}`);
  await page.locator("[data-cy='invoice-payment-received']").first().click();
  await page.locator("[data-cy='pay-received-form']").waitFor({
    timeout: 15_000,
  });
  await page.locator("[data-cy='pay-method-zelle']").click();
}

async function countPosts(page: StoryTools["page"]) {
  const box = { n: 0 };
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/api\/payments$/.test(req.url())) {
      box.n++;
    }
  });
  return box;
}

Deno.test("REQ-551 (a): above the balance asks first; 'Record anyway' records it and /payments counts only what was owed", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await sentInvoice(http, auth);
    await openPayForm(page, inv.id);
    const posts = await countPosts(page);
    await page.locator("[data-cy='pay-received-amount']").fill("100");
    await page.locator("[data-cy='pay-received-submit']").click();
    const ask = page.locator("[data-cy='pay-received-over']");
    await ask.waitFor({ timeout: 15_000 });
    const text = (await ask.innerText()).replace(/\s+/g, " ").trim();
    expect(
      text.includes(
        "This is $35.00 more than the $65.00 owed. Record it anyway?",
      ),
      `the question (${text})`,
    );
    await page.waitForTimeout(500);
    expect.eq(posts.n, 0, "no POST /payments before the confirm");
    await page.locator("[data-cy='pay-received-over-confirm']").click();
    const flash = page.locator("[data-cy='payment-recorded']");
    await flash.waitFor({ timeout: 15_000 });
    expect.eq(posts.n, 1, "one POST /payments after the confirm");
    const inv2 = await (await http(`/api/invoices/${inv.id}`, {
      headers: auth,
    })).json();
    expect.eq(inv2.overpaidCents, 3500, "the invoice flags $35 overpaid");

    await page.goto("/payments");
    const over = page.locator("[data-cy='payments-overpaid']");
    await over.waitFor({ timeout: 15_000 });
    const overText = (await over.innerText()).trim();
    expect(overText.includes("$35"), `the overpaid line (${overText})`);
    const amount = (await page.locator(".pph__title-amount").innerText())
      .replace(/\s+/g, "");
    expect.eq(amount, "$65", "the hero counts what was owed, not $100");
  }));

Deno.test("REQ-551 (b): over 10x the invoice is refused and nothing is sent", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await sentInvoice(http, auth);
    await openPayForm(page, inv.id);
    const posts = await countPosts(page);
    await page.locator("[data-cy='pay-received-amount']").fill("1000");
    await page.locator("[data-cy='pay-received-submit']").click();
    const err = page.locator("[data-cy='pay-received-error']");
    await err.waitFor({ timeout: 15_000 });
    const text = (await err.innerText()).trim();
    expect.eq(
      text,
      "That's more than 10 times the $65.00 invoice. Check the amount.",
      `the refusal (${text})`,
    );
    expect.eq(
      await page.locator("[data-cy='pay-received-over-confirm']").count(),
      0,
      "no 'Record anyway' for this",
    );
    await page.waitForTimeout(500);
    expect.eq(posts.n, 0, "no POST /payments left the page");
  }));
