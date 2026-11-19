/**
 * REQ-1111 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 3, issue
 * q3-36: "Reminder and nudge emails print raw ISO dates (EN and ES)".
 *
 * In a browser: a past-due invoice is nudged from the customer page's Remind
 * (an English customer) and from /invoices' overdue "Send nudge" (a Spanish
 * customer). The reminder email in the Outbox must name the due date in the
 * long form every other paperwork email uses ("November 9, 2026" /
 * "9 de noviembre de 2026"), never "Due 2026-11-09" / "Vence 2026-11-09".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const longDate = (d: string, lang: "en" | "es") =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString(
    lang === "es" ? "es-US" : "en-US",
    { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" },
  );

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

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return await r.json();
}

type Row = {
  id: string;
  kind: string;
  channel: string;
  customerId?: string;
};

async function seed(
  http: StoryTools["http"],
  auth: Record<string, string>,
  lang: "en" | "es",
  jobName: string,
) {
  const customer = await post(http, auth, "/api/customers", {
    name: lang === "es" ? `Carmen Vega ${digits()}` : `Rosa Hill ${digits()}`,
    email: `q336-${lang}@blackhole.postmarkapp.com`,
    language: lang,
  });
  const dueDate = iso(-10);
  const inv = await post(http, auth, "/api/invoices", {
    customerId: customer.id,
    status: "sent",
    jobName,
    description: jobName,
    lineItems: [{ description: jobName, quantity: 1, price: 82_067 }],
    amount: 82_067,
    issuedDate: iso(-40),
    dueDate,
  });
  return { customer, inv, dueDate };
}

async function reminderBody(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customerId: string,
  page: StoryTools["page"],
) {
  let mail: Row | undefined;
  for (let i = 0; i < 25 && !mail; i++) {
    const rows = (await (await http("/api/outbox", { headers: auth }))
      .json()) as Row[];
    mail = rows.find((r) =>
      r.customerId === customerId && r.kind === "reminder" &&
      r.channel === "email"
    );
    if (!mail) await page.waitForTimeout(400);
  }
  if (!mail) throw new Error("no reminder email in the Outbox");
  const { body } = await (await http(`/api/outbox/${mail.id}`, {
    headers: auth,
  })).json() as { body: string };
  // the visible text only: hrefs may carry anything
  return body.replace(/href="[^"]*"/g, "").replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function checkDue(
  expect: StoryTools["expect"],
  text: string,
  dueDate: string,
  lang: "en" | "es",
) {
  const word = lang === "es" ? "Vence" : "Due";
  const dueLine = text.match(new RegExp(`${word} [^·]{0,40}`))?.[0] ??
    "(no due line)";
  expect(
    !text.includes(dueDate),
    `the ${lang} reminder email prints the raw ISO due date: "${dueLine.trim()}"`,
  );
  const want = longDate(dueDate, lang);
  expect(
    text.includes(want),
    `the ${lang} reminder email names the due date "${want}" (got "${dueLine.trim()}")`,
  );
}

Deno.test("REQ-1111 (LOOP-007 q3, q3-36): the customer page's Remind emails an English reminder whose due date reads in the long form, never ISO", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const { customer, dueDate } = await seed(
      http,
      auth,
      "en",
      "Deck stain REQ-1111",
    );

    // every reminder POST's status, in order
    const statuses: number[] = [];
    page.on("response", (r) => {
      if (
        r.request().method() === "POST" &&
        r.url().includes("/api/cron/invoice-reminder")
      ) statuses.push(r.status());
    });
    await page.goto(`/customers/${customer.id}`);
    await page.locator(
      `[data-cy='customer-workspace'][data-customer='${customer.id}']`,
    ).waitFor({ timeout: 20_000 });
    const remind = page.locator("[data-cy='cws-remind']");
    await remind.waitFor({ timeout: 15_000 });
    const sheet = page.locator("[data-cy='send-dialog']");
    // the island may still be hydrating: click until Remind posts or opens
    // its sheet (whose primary button then sends)
    let acted = false;
    for (let attempt = 0; attempt < 10 && !acted; attempt++) {
      await remind.click({ timeout: 2_000 }).catch(() => {});
      for (let i = 0; i < 5 && !acted; i++) {
        if (statuses.length > 0) acted = true;
        else if (await sheet.isVisible()) {
          await page.locator("[data-cy='send-keep']").click();
          acted = true;
        } else await page.waitForTimeout(200);
      }
    }
    for (let i = 0; i < 100 && statuses.length === 0; i++) {
      await page.waitForTimeout(200);
    }
    expect.eq(statuses[0], 200, "the reminder endpoint accepted it");

    checkDue(
      expect,
      await reminderBody(http, auth, customer.id, page),
      dueDate,
      "en",
    );
  }));

Deno.test("REQ-1111 (LOOP-007 q3, q3-36): /invoices' Send nudge emails a Spanish reminder whose due date reads '… de … de …', never ISO", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const job = `Piso de cocina REQ-1111 ${digits()}`;
    const { customer, dueDate } = await seed(http, auth, "es", job);

    await page.goto("/invoices");
    const card = page.locator(".qcard", {
      has: page.locator("[data-cy='invoice-card-job']", { hasText: job }),
    });
    await card.waitFor({ timeout: 15_000 });
    const cta = card.locator("[data-cy='invoice-cta-overdue']");
    await cta.waitFor({ timeout: 15_000 });
    const sent = page.waitForResponse(
      (r) => r.url().includes("/api/cron/invoice-reminder"),
      { timeout: 15_000 },
    );
    await cta.click();
    // REQ-1112 (q3-37): every /invoices nudge opens its preview dialog first — Send there
    await page.locator("[data-cy='send-dialog'] [data-cy='send-keep']").click({ timeout: 15_000 });
    const res = await sent;
    expect.eq(res.status(), 200, "the reminder endpoint accepted it");

    checkDue(
      expect,
      await reminderBody(http, auth, customer.id, page),
      dueDate,
      "es",
    );
  }));
