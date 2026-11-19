/**
 * REQ-963 — LOOP-007 cycle 1, issue q1-37 "No receipt for a hand-recorded
 * part payment", in a browser on the real shell.
 *
 * QA recorded a $400 check on a $1,000 invoice in /invoices → Record payment.
 * The page said "Payment of $400.00 recorded"; the outbox gained nothing and
 * the customer never got a receipt. The story: record the part payment in
 * the dialog, then open /messages — the outbox lists a Receipt email to the
 * customer.
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
    body: JSON.stringify({ language: "en", name: "Luis Ortega" }),
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
      name: "Pat Doe",
      email: "pat.doe@blackhole.postmarkapp.com",
    }),
  })).json();
  const inv = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      status: "sent",
      jobName: "Kitchen repaint",
      dueDate: inDays(7),
      lineItems: [{
        description: "Kitchen repaint",
        quantity: 1,
        unit: "job",
        price: 100000,
      }],
      amount: 100000,
    }),
  })).json();
  return inv as { id: string };
}

type Row = { kind: string; channel: string; status: string };

Deno.test("REQ-963 q1-37: a $400 part payment recorded in /invoices → Record payment puts a Receipt email to the customer in the Outbox", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await sentInvoice(http, auth);
    const before = await (await http("/api/outbox", { headers: auth }))
      .json() as Row[];

    await page.goto(`/invoices?open=${inv.id}`);
    await page.locator("[data-cy='invoice-payment-received']").first().click();
    await page.locator("[data-cy='pay-received-form']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='pay-method-check']").click();
    await page.locator("[data-cy='pay-received-amount']").fill("400");
    // wait on the POST itself, not the toast
    const posted = page.waitForResponse((res) =>
      res.request().method() === "POST" && /\/api\/payments$/.test(res.url())
    );
    await page.locator("[data-cy='pay-received-submit']").click();
    const res = await posted;
    expect(res.ok(), `POST /payments → ${res.status()}`);
    await page.locator("[data-cy='pay-received-form']").waitFor({
      state: "hidden",
      timeout: 15_000,
    });

    const after = await (await http("/api/outbox", { headers: auth }))
      .json() as Row[];
    const receipts = (rows: Row[]) =>
      rows.filter((r) => r.kind === "receipt" && r.channel === "email");
    expect.eq(
      receipts(after).length - receipts(before).length,
      1,
      `the outbox gained one receipt email (outbox: ${
        JSON.stringify(after.map((r) => `${r.kind}:${r.channel}`))
      })`,
    );

    await page.goto("/messages");
    const rows = page.locator("[data-cy='outbox-row']");
    await rows.first().waitFor({ timeout: 20_000 });
    const what = page.locator("[data-cy='outbox-row-what']", {
      hasText: "Receipt",
    });
    expect.eq(await what.count(), 1, "a Receipt row on /messages");
  }));

/**
 * REQ-1071 — LOOP-007 cycle 2, issue q2-60 "Partial-payment receipt shows no
 * remaining balance and no pay link". QA paid $500 of a $1,190.75 invoice;
 * the receipt in the outbox read "We've recorded your payment of
 * <strong>$500</strong>…" — no cents, no balance, no way back to pay it.
 */
Deno.test("REQ-1071 q2-60: a $500 part payment on a $1,190.75 invoice puts a receipt in the Outbox that shows $500.00, the $690.75 balance and a pay link", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Pat Doe",
        email: "pat.doe@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Kitchen repaint",
        dueDate: inDays(7),
        lineItems: [{
          description: "Kitchen repaint",
          quantity: 1,
          unit: "job",
          price: 119075,
        }],
        amount: 119075,
      }),
    })).json() as { id: string };

    await page.goto(`/invoices?open=${inv.id}`);
    await page.locator("[data-cy='invoice-payment-received']").first().click();
    await page.locator("[data-cy='pay-received-form']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='pay-method-check']").click();
    await page.locator("[data-cy='pay-received-amount']").fill("500");
    const posted = page.waitForResponse((res) =>
      res.request().method() === "POST" && /\/api\/payments$/.test(res.url())
    );
    await page.locator("[data-cy='pay-received-submit']").click();
    const res = await posted;
    expect(res.ok(), `POST /payments → ${res.status()}`);

    const rows = await (await http("/api/outbox", { headers: auth }))
      .json() as (Row & { id: string; docId?: string })[];
    const row = rows.find((r) =>
      r.kind === "receipt" && r.channel === "email" && r.docId === inv.id
    );
    expect(!!row, "a receipt email for this invoice is in the outbox");
    if (!row) return;
    const opened = await (await http(`/api/outbox/${row.id}`, {
      headers: auth,
    })).json() as { body?: string };
    const body = opened.body ?? "";
    expect(body.includes("$500.00"), "the receipt prints $500.00");
    expect(
      body.includes("$690.75"),
      `the receipt shows the $690.75 balance still due (body: ${
        body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400)
      })`,
    );
    expect(
      /href="[^"]*\/(s|i)\/[^"]+"/.test(body),
      "the receipt links back to the invoice to pay the balance",
    );
  }));
