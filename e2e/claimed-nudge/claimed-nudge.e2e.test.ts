/**
 * REQ-250 — demo issue quote-invoice-money-m12 (Pair 9): "a payment reminder
 * can be sent after the client reported paying, with no warning". In a
 * browser: the customer claims "Zelle, ref ZL-88412"; on the claimed card's
 * back "Send a nudge" asks first and sends nothing until "Send anyway".
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
    body: JSON.stringify({ language: "en", name: "Invoice Story" }),
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

Deno.test("REQ-250 m12: a nudge on a claimed invoice asks first — naming the claim — and only 'Send anyway' sends a reminder", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Juan Pérez",
        email: "juan@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Fence repair REQ-250",
        description: "Fence repair",
        lineItems: [{ description: "Fence repair", quantity: 1, price: 48000 }],
        amount: 48000,
        dueDate: "2026-01-05",
      }),
    })).json();
    const claim = await http(`/api/invoices/${inv.id}/claim-payment`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        method: "zelle",
        reference: "ZL-88412",
        claimedBy: "Juan",
      }),
    });
    expect.eq(claim.status, 200, "the customer's claim is recorded");
    await claim.body?.cancel();

    const reminders: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/cron/invoice-reminder")) {
        reminders.push(r.url());
      }
    });

    await page.goto("/invoices");
    const card = page.locator(".qcard", {
      has: page.locator("[data-cy='invoice-card-job']", {
        hasText: "Fence repair REQ-250",
      }),
    });
    await card.waitFor({ timeout: 15_000 });
    await card.click(); // flip to the back face
    const nudge = card.locator("[data-cy='invoice-nudge']");
    await nudge.click();
    const ask = card.locator("[data-cy='invoice-nudge-ask']");
    await ask.waitFor({ timeout: 15_000 });
    const askText = await ask.innerText();
    expect(
      askText.includes("Juan") && askText.includes("Zelle") &&
        askText.includes("ZL-88412"),
      `the ask names who, how and the reference (${askText})`,
    );
    expect.eq(reminders.length, 0, "the first click sent no reminder");

    await card.locator("[data-cy='invoice-nudge-ask-no']").click();
    await ask.waitFor({ state: "hidden", timeout: 15_000 });
    expect.eq(reminders.length, 0, "Cancel sent no reminder");

    await nudge.click();
    const sent = page.waitForRequest(
      (r) => r.url().includes("/api/cron/invoice-reminder"),
      { timeout: 15_000 },
    );
    await card.locator("[data-cy='invoice-nudge-ask-yes']").click();
    await sent;
    expect.eq(reminders.length, 1, "'Send anyway' sends exactly one reminder");
  }));
