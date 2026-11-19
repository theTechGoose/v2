/**
 * REQ-1130 (LOOP-007 q3, q3-59) — Raphael: "test every single aspect of this
 * application … one Opus agent per issue to do root cause analysis, then one
 * to write the test, then one to fix it and make it green."
 *
 * QA recorded $1,100 cash on a $1,035.50 invoice and confirmed "Record
 * anyway" (REQ-551). The paid email in the outbox (010-email) read "Overpaid
 * by $64.50 — we will refund or credit this": a promise the owner never made,
 * while /i says just "Overpaid by $64.50". The story: record the overpayment
 * in the browser, open the paid email from the outbox, and check its
 * [data-overpaid] line flags $64.50 with no refund-or-credit promise and in
 * the same words as /i.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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

type Row = { id: string; kind: string; channel: string; docId?: string };

Deno.test("REQ-1130 (LOOP-007 q3, q3-59): $1,100 recorded anyway on a $1,035.50 invoice — the paid email flags 'Overpaid by $64.50' with no refund-or-credit promise, like /i", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Maria Lopez",
        email: "maria.lopez@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Kitchen floor",
        dueDate: inDays(7),
        lineItems: [{
          description: "Kitchen floor",
          quantity: 1,
          unit: "job",
          price: 103550,
        }],
        amount: 103550,
      }),
    })).json() as { id: string };

    await page.goto(`/invoices?open=${inv.id}`);
    await page.locator("[data-cy='invoice-payment-received']").first().click();
    await page.locator("[data-cy='pay-received-form']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='pay-method-cash']").click();
    await page.locator("[data-cy='pay-received-amount']").fill("1100");
    await page.locator("[data-cy='pay-received-submit']").click();
    await page.locator("[data-cy='pay-received-over']").waitFor({
      timeout: 15_000,
    });
    const posted = page.waitForResponse((res) =>
      res.request().method() === "POST" && /\/api\/payments$/.test(res.url())
    );
    await page.locator("[data-cy='pay-received-over-confirm']").click();
    const res = await posted;
    expect(res.ok(), `POST /payments → ${res.status()}`);

    const after = await (await http(`/api/invoices/${inv.id}`, {
      headers: auth,
    })).json() as { status?: string; overpaidCents?: number };
    expect.eq(after.status, "paid", "the invoice is paid");
    expect.eq(after.overpaidCents, 6450, "the invoice flags $64.50 overpaid");

    const rows = await (await http("/api/outbox", { headers: auth }))
      .json() as Row[];
    const emails = rows.filter((r) =>
      r.channel === "email" && r.docId === inv.id
    );
    let line: string | undefined;
    for (const row of emails) {
      const opened = await (await http(`/api/outbox/${row.id}`, {
        headers: auth,
      })).json() as { body?: string };
      const m = (opened.body ?? "").match(
        /<div data-overpaid[^>]*>([^<]*)<\/div>/,
      );
      if (m) line = m[1].trim();
    }
    expect(
      line !== undefined,
      `a paid email in the outbox flags the overpayment (emails: ${
        emails.map((r) => r.kind).join(", ")
      })`,
    );
    expect(
      !/refund|credit/i.test(line ?? ""),
      `the paid email promises a refund or credit on the owner's behalf: "${line}"`,
    );
    expect.eq(line, "Overpaid by $64.50", "the email reads like /i");

    await page.goto(`/i/${inv.id}`);
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(
      body.includes("Overpaid by $64.50"),
      "/i flags 'Overpaid by $64.50'",
    );
  }));
