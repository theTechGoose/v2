/**
 * REQ-1031 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 2, issue q2-8:
 * "Customer-page Remind re-sends the original invoice email word for word
 * instead of a reminder".
 *
 * In a browser: a customer with an email, an invoice emailed to her and now
 * past due. On /customers/<id>, Remind sends the invoice's reminder nudge —
 * a POST to /api/cron/invoice-reminder (REQ-021 / REQ-477), never the
 * first-send /api/invoices/:id/email|text — and the Outbox's newest email to
 * her is a reminder whose subject differs from the first-send invoice email.
 * Before the fix Remind opened the generic send sheet and its Send re-posted
 * /api/invoices/:id/email: the same subject and body as the original send.
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
    body: JSON.stringify({ language: "en", name: "Remind Story" }),
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

const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

type Row = {
  id: string;
  createdAt: string;
  channel: string;
  status: string;
  kind: string;
  customerId?: string;
  docId?: string;
  subject?: string;
};

const SEND_PATHS = /\/api\/invoices\/[^/]+\/(email|text)$/;
const REMINDER_PATH = /\/api\/cron\/invoice-reminder$/;

Deno.test("REQ-1031 (LOOP-007 q2-8): the customer page's Remind sends the reminder nudge (/api/cron/invoice-reminder), never the original invoice email again", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: `Rosa Remind ${digits()}`,
        email: "rosa@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Deck stain REQ-1031",
        description: "Deck stain",
        lineItems: [{ description: "Deck stain", quantity: 1, price: 48000 }],
        amount: 48000,
        // issued 40 days ago on 30-day terms → 10 days past due, so the
        // header's Remind is shown
        issuedDate: iso(-40),
        dueDate: iso(-10),
      }),
    })).json();
    expect(typeof inv.id === "string", `invoice created (${JSON.stringify(inv)})`);

    // the first send: the ordinary invoice email
    const first = await http(`/api/invoices/${inv.id}/email`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    });
    expect.eq(first.status, 200, "the invoice's first email went");
    await first.body?.cancel();
    const outboxOf = async () =>
      ((await (await http("/api/outbox", { headers: auth })).json()) as Row[])
        .filter((r) => r.customerId === customer.id && r.channel === "email");
    const before = await outboxOf();
    const firstMail = before.find((r) => r.kind === "invoice");
    expect(
      !!firstMail,
      `the Outbox has the first-send invoice email (${JSON.stringify(before)})`,
    );

    // every POST the page makes to a send or reminder endpoint, in order
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "POST") return;
      const p = new URL(r.url()).pathname;
      if (SEND_PATHS.test(p) || REMINDER_PATH.test(p)) posts.push(p);
    });

    await page.goto(`/customers/${customer.id}`);
    await page.locator(
      `[data-cy='customer-workspace'][data-customer='${customer.id}']`,
    ).waitFor({ timeout: 20_000 });
    const remind = page.locator("[data-cy='cws-remind']");
    await remind.waitFor({ timeout: 15_000 });

    // Remind either sends straight away or opens a sheet/confirm whose
    // primary button sends; the island may still be hydrating, so click
    // until something happens.
    const sheet = page.locator("[data-cy='send-dialog']");
    let opened = false;
    for (let attempt = 0; attempt < 10 && !opened; attempt++) {
      try {
        await remind.click({ timeout: 2_000 });
      } catch {
        // not clickable yet
      }
      for (let i = 0; i < 5; i++) {
        if (posts.length > 0 || await sheet.isVisible()) {
          opened = true;
          break;
        }
        await page.waitForTimeout(200);
      }
    }
    expect(opened, "Remind did something (sent, or opened its sheet)");
    if (posts.length === 0 && await sheet.isVisible()) {
      await page.locator("[data-cy='send-keep']").click();
    }

    // wait for the first send/reminder POST to settle
    const deadline = Date.now() + 20_000;
    while (posts.length === 0 && Date.now() < deadline) {
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1_500); // let a second channel's POST land too
    expect(
      !posts.some((p) => SEND_PATHS.test(p)),
      `Remind must not re-send the invoice: it POSTed ${
        JSON.stringify(posts)
      } (the first-send /api/invoices/:id/email|text), not /api/cron/invoice-reminder`,
    );
    expect(
      posts.some((p) => REMINDER_PATH.test(p)),
      `Remind POSTs the reminder nudge /api/cron/invoice-reminder (got ${
        JSON.stringify(posts)
      })`,
    );

    // the durable signal: the Outbox's newest email to her is a reminder,
    // and it is not the first-send invoice email again
    let after: Row[] = [];
    for (let i = 0; i < 25; i++) {
      after = await outboxOf();
      if (after.length > before.length) break;
      await page.waitForTimeout(400);
    }
    const fresh = after.filter((r) => !before.some((b) => b.id === r.id));
    expect.eq(fresh.length, 1, `one new email to her (${JSON.stringify(fresh)})`);
    expect.eq(
      fresh[0]?.kind,
      "reminder",
      `the new email is a reminder, not the invoice again (${
        JSON.stringify(fresh[0])
      })`,
    );
    expect(
      (fresh[0]?.subject ?? "") !== (firstMail?.subject ?? ""),
      `the reminder's subject differs from the first send ("${firstMail?.subject}" vs "${
        fresh[0]?.subject
      }")`,
    );
  }));
