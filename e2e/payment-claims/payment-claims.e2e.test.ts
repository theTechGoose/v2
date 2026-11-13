/**
 * REQ-281 (demo M34) in a browser: a customer's "I paid by Zelle" claim on
 * the public invoice shows on /payments under "Needs attention" (KPI 1, the
 * held-up amount, a claim card), and "Got it" confirms it — the card leaves
 * and the payment lands.
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
    body: JSON.stringify({ language: "en", name: "Claims Story" }),
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

/** an island may still be hydrating when its button appears: click until the page shows the effect */
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
      // gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-281: a customer's Zelle claim shows on /payments under Needs attention (KPI 1, $420 held up, a claim card); confirming it lands the payment", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Maria Lopez",
        email: "maria.lopez@blackhole.postmarkapp.com",
        phoneNumber: "+15125550281",
      }),
    })).json();
    const today = new Date().toISOString().slice(0, 10);
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        jobName: "Deck stain",
        lineItems: [{
          description: "Deck stain",
          quantity: 1,
          unit: "job",
          price: 42000,
        }],
        amount: 42000,
        status: "sent",
        issuedDate: today,
        dueDate: today,
      }),
    })).json();
    // the customer, signed out, says "I paid by Zelle"
    const claim = await http(`/api/invoices/${inv.id}/claim-payment`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ method: "zelle", reference: "ZL-281" }),
    });
    expect.eq(claim.status, 200, "the public claim is accepted");
    await claim.body?.cancel();

    await page.goto("/payments");
    await page.locator("[data-cy='payment-claim']").first().waitFor({
      timeout: 15_000,
    });
    const card = page.locator("[data-cy='payment-claim']");
    expect.eq(await card.count(), 1, "one claim card");
    const text = await card.first().innerText();
    expect.eq(
      text.includes("Maria Lopez"),
      true,
      `the card names the client: ${text}`,
    );
    expect.eq(
      text.includes("$420"),
      true,
      `the card shows the claimed amount: ${text}`,
    );
    expect.eq(/zelle/i.test(text), true, `the card shows the method: ${text}`);
    expect.eq(
      text.includes("ZL-281"),
      true,
      `the card shows the reference: ${text}`,
    );
    expect.eq(
      (await page.locator("[data-cy='payments-kpi-attention']").innerText())
        .trim(),
      "1",
      "the Needs attention KPI counts the claim",
    );
    await expect.see("$420 held up");

    await clickUntil(
      page,
      "[data-cy='payment-claim-confirm']",
      async () =>
        (await page.locator("[data-cy='payment-claim']").count()) === 0,
    );
    expect.eq(
      (await page.locator("[data-cy='payments-kpi-attention']").innerText())
        .trim(),
      "0",
      "the confirmed claim leaves the attention count",
    );
    const rows = await (await http(`/api/payments?invoiceId=${inv.id}`, {
      headers: auth,
    })).json();
    expect.eq(rows.length, 1, "confirming records the payment");
    await expect.see("Landed this month");
  }));
