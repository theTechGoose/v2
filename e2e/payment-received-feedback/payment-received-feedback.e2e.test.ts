/**
 * REQ-322 — demo-loop cycle 1, issue m36: "Recording a payment fails with no
 * reason and succeeds with no message", in a browser on the real shell.
 *
 *   (a) with the "Received on" date cleared, Save says the date is missing
 *       and no POST /payments leaves the page
 *   (b) with a date, Save closes the form and the page confirms
 *       "Payment of $65.00 recorded"
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
    body: JSON.stringify({ language: "en", name: "Payment Story" }),
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

Deno.test("REQ-322 (a): with the date cleared, Save says the date is missing and sends nothing", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await sentInvoice(http, auth);
    await openPayForm(page, inv.id);
    let posts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/api\/payments$/.test(req.url())) {
        posts++;
      }
    });
    await page.locator("[data-cy='pay-received-date']").fill("");
    await page.locator("[data-cy='pay-received-submit']").click();
    const err = page.locator("[data-cy='pay-received-error']");
    await err.waitFor({ timeout: 15_000 });
    const text = (await err.innerText()).trim();
    expect.eq(text, "Pick the day you received it.", `the reason (${text})`);
    await page.waitForTimeout(500);
    expect.eq(posts, 0, "no POST /payments left the page");
    expect(
      await page.locator("[data-cy='pay-received-form']").isVisible(),
      "the form stays open",
    );
  }));

Deno.test("REQ-322 (b): with a date, Save closes the form and the page says 'Payment of $65.00 recorded'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await sentInvoice(http, auth);
    await openPayForm(page, inv.id);
    await page.locator("[data-cy='pay-received-submit']").click();
    await page.locator("[data-cy='pay-received-form']").waitFor({
      state: "hidden",
      timeout: 15_000,
    });
    const flash = page.locator("[data-cy='payment-recorded']");
    await flash.waitFor({ timeout: 15_000 });
    const text = (await flash.innerText()).replace(/\s+/g, " ").trim();
    expect.eq(text, "Payment of $65.00 recorded", `the flash (${text})`);
  }));
