/**
 * REQ-243 — demo issue quote-invoice-money-m3, "Counts and headlines
 * contradict the lists", in a browser on the real shell:
 *
 *   (a) "1 open quote across 0 clients" over a card that names Maria Lopez
 *   (d) "All clear — nothing outstanding." over a payment the customer claimed
 *   (e) the /invoices hero still promising the money after "Payment received"
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
    body: JSON.stringify({ language: "en", name: "Headline Story" }),
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
      // REQ-484: "this week" ends Sunday — due today is this week on any
      // weekday the lane runs (today+2 is next week on a Friday).
      dueDate: inDays(0),
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

async function heroText(page: StoryTools["page"]) {
  const hero = page.locator("[data-cy='forecast-hero']");
  await hero.waitFor({ timeout: 15_000 });
  return (await hero.innerText()).replace(/\s+/g, " ").trim();
}

Deno.test("REQ-243 (d): a payment the customer claimed is never 'All clear' — the hero says it is waiting for your confirmation", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await sentInvoice(http, auth);
    const claim = await http(`/api/invoices/${inv.id}/claim-payment`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ method: "zelle", claimedBy: "Randall" }),
    });
    expect.eq(claim.status, 200, "the customer's claim is recorded");
    await claim.body?.cancel();
    await page.goto("/invoices");
    const text = await heroText(page);
    expect(!/All clear/i.test(text), `the hero is not 'All clear' (${text})`);
    expect(
      /waiting for your confirmation/i.test(text),
      `the hero names the claim waiting for confirmation (${text})`,
    );
  }));

Deno.test("REQ-243 (e): after 'Payment received' the /invoices hero stops promising that money", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await sentInvoice(http, auth);
    await page.goto(`/invoices?open=${inv.id}`);
    const before = await heroText(page);
    expect(
      /\$65(\.00)? expected this week/i.test(before),
      `before: the sent invoice is expected this week (${before})`,
    );
    await page.locator("[data-cy='invoice-payment-received']").first()
      .click();
    await page.locator("[data-cy='pay-received-form']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='pay-method-zelle']").click();
    await page.locator("[data-cy='pay-received-submit']").click();
    await page.locator("[data-cy='pay-received-form']").waitFor({
      state: "hidden",
      timeout: 15_000,
    });
    const hero = page.locator("[data-cy='forecast-hero']");
    let after = "";
    for (let i = 0; i < 30; i++) {
      after = (await hero.innerText()).replace(/\s+/g, " ").trim();
      if (/All clear/i.test(after)) break;
      await page.waitForTimeout(200);
    }
    expect(
      !/expected this week/i.test(after),
      `after: the paid invoice is no longer 'expected this week' (${after})`,
    );
    expect(/All clear/i.test(after), `after: the hero is all clear (${after})`);
  }));

Deno.test("REQ-243 (a): an open quote whose card names Maria Lopez counts one client, not 0", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const q = await http("/api/quotes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        summary: "Patio pavers — Maria Lopez",
        jobName: "Patio pavers",
        lineItems: [{
          description: "Patio pavers (200 sqft)",
          quantity: 1,
          unit: "ea",
          price: 350_000,
        }],
        estimatedTotal: 350_000,
      }),
    });
    expect(q.status < 300, `the quote is created (${q.status})`);
    await q.body?.cancel();
    await page.goto("/quotes");
    const card = page.locator(".qcard", { hasText: "Patio pavers" });
    await card.first().waitFor({ timeout: 15_000 });
    await expect.see("Maria Lopez");
    const sub = page.locator(".qph__sub").first();
    const text = (await sub.innerText()).replace(/\s+/g, " ");
    expect(
      /1 open quote across 1 client\b/.test(text),
      `the hero counts the card's client (${text})`,
    );
  }));

/** REQ-317 (demo-loop cycle 1, M33): a 50/50 job — the $1,600 deposit is
 *  sent, the $1,600 balance is a scheduled installment of the signed
 *  agreement. Once the deposit is recorded the hero must still say money is
 *  to come, never "All clear — nothing outstanding." */
Deno.test("REQ-317 / REQ-697: a 50/50 job after the deposit — the hero says $1,600 is scheduled and unsent, with its reminder and due dates, never 'All clear'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Dana Whitfield",
        email: "dw@blackhole.postmarkapp.com",
      }),
    })).json();
    const half = {
      description: "Deck rebuild (installment)",
      quantity: 1,
      unit: "job",
      price: 160_000,
    };
    const deposit = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Deck rebuild",
        dueDate: inDays(2),
        lineItems: [half],
        amount: 160_000,
        installmentIndex: 1,
        installmentTotal: 2,
      }),
    })).json();
    const balance = await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "scheduled",
        scheduledFor: inDays(21),
        jobName: "Deck rebuild",
        dueDate: inDays(28),
        lineItems: [half],
        amount: 160_000,
        installmentIndex: 2,
        installmentTotal: 2,
      }),
    });
    expect(
      balance.status < 300,
      `the balance is scheduled (${balance.status})`,
    );
    await balance.body?.cancel();

    await page.goto(`/invoices?open=${deposit.id}`);
    await page.locator("[data-cy='invoice-payment-received']").first()
      .click();
    await page.locator("[data-cy='pay-received-form']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='pay-method-zelle']").click();
    await page.locator("[data-cy='pay-received-submit']").click();
    await page.locator("[data-cy='pay-received-form']").waitFor({
      state: "hidden",
      timeout: 15_000,
    });
    const hero = page.locator("[data-cy='forecast-hero']");
    let after = "";
    for (let i = 0; i < 30; i++) {
      after = (await hero.innerText()).replace(/\s+/g, " ").trim();
      if (!/expected this week/i.test(after)) break;
      await page.waitForTimeout(200);
    }
    expect(
      !/All clear/i.test(after),
      `after the deposit the hero is not 'All clear' (${after})`,
    );
    expect(
      /\$1,600 scheduled — not sent yet/i.test(after),
      `the hero names the scheduled balance as unsent (${after})`,
    );
    // REQ-697 (cycle 5, m13): no week in the eyebrow outside a week headline
    const eyebrow = (await page.locator(".qph__eyebrow").first().innerText())
      .replace(/\s+/g, " ").trim();
    expect(
      eyebrow === "Receivables",
      `the eyebrow names no week (${eyebrow})`,
    );
    const sub = page.locator(".qph__sub").first();
    const subText = (await sub.innerText()).replace(/\s+/g, " ").trim();
    const short = (iso: string) =>
      new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    expect(
      subText.includes(
        `Next installment — we'll remind you to send it on ${
          short(inDays(21))
        } · due ${short(inDays(28))}`,
      ) && /1 scheduled invoice\b/.test(subText),
      `the sub line gives the reminder date, the due date and the count (${subText})`,
    );
  }));
