/**
 * REQ-1116 — LOOP-007 cycle 3, issue q3-40 "Confirming a claimed payment
 * sends two separate 'paid' emails", in a browser on the real shell.
 *
 * QA's customer paid the whole invoice by Zelle on /i ("I sent it"); the
 * owner pressed "Okay, I got it" on /invoices → "Mark as paid". The outbox
 * gained TWO customer emails in the same second: "Paid — Invoice INV-001
 * from …" and "Receipt for INV-001". REQ-963: the payment that closes the
 * balance sends exactly one customer email (the PAID invoice).
 *
 * The customer's claim is the same public POST /i makes (no session — the
 * owner's own session is refused, REQ-479); the owner's half is clicked.
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
    body: JSON.stringify({ language: "en", name: "Mark Paid Story" }),
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

type Row = { kind: string; channel: string; docId?: string; to?: string };

Deno.test("REQ-1116 (LOOP-007 q3-40) / REQ-963: confirming a customer's full Zelle claim on /invoices (Okay, I got it → Mark as paid) puts exactly ONE customer email in the Outbox", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const job = `Cedar fence ${digits()}`;
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Dana Customer",
        email: "dana.customer@blackhole.postmarkapp.com",
      }),
    })).json();
    const today = new Date().toISOString().slice(0, 10);
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        jobName: job,
        lineItems: [{
          description: job,
          quantity: 1,
          unit: "job",
          price: 30000,
        }],
        amount: 30000,
        status: "sent",
        issuedDate: today,
        dueDate: today,
      }),
    })).json() as { id: string };

    // the customer, on /i: Zelle → "I sent it" — the whole balance
    const claim = await http(`/api/invoices/${inv.id}/claim-payment`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ method: "zelle", claimedBy: "Dana Customer" }),
    });
    if (claim.status !== 200) throw new Error(`claim: ${claim.status}`);
    await claim.body?.cancel();

    const emailsFor = (rows: Row[]) =>
      rows.filter((r) => r.channel === "email" && r.docId === inv.id);
    const before = await (await http("/api/outbox", { headers: auth }))
      .json() as Row[];

    // the owner, on /invoices: "Okay, I got it" → "Mark as paid"
    await page.goto("/invoices");
    const cta =
      `article.qcard:has-text("${job}") [data-cy='invoice-cta-claimed']`;
    await page.locator(cta).waitFor({ timeout: 15_000 });
    await clickUntil(
      page,
      cta,
      async () =>
        (await page.locator("[data-cy='mark-paid-dialog']").count()) === 1,
    );
    const confirmed = page.waitForResponse((res) =>
      res.request().method() === "POST" &&
      /\/confirm-payment$/.test(res.url())
    );
    await page.locator("[data-cy='mark-paid-confirm']").click();
    const res = await confirmed;
    expect(res.ok(), `POST /confirm-payment → ${res.status()}`);
    await page.locator("[data-cy='payment-confirmed']").waitFor({
      timeout: 15_000,
    });

    const inv2 = await (await http(`/api/invoices/${inv.id}`, {
      headers: auth,
    })).json();
    expect.eq(inv2.status, "paid", "the claim closed the bill");
    const after = await (await http("/api/outbox", { headers: auth }))
      .json() as Row[];
    expect.eq(
      emailsFor(after).length - emailsFor(before).length,
      1,
      `the outbox gained exactly one customer email (new: ${
        JSON.stringify(
          emailsFor(after).slice(
            0,
            emailsFor(after).length -
              emailsFor(before).length,
          ).map((r) => `${r.kind}:${r.channel}`),
        )
      })`,
    );
  }));
