/**
 * REQ-943 — LOOP-007 cycle 1, issues q1-8 and q1-9, in a browser on the real
 * shell.
 *
 *   (q1-8) the customer page → Record payment → "Received on" a day after
 *          today → an inline reason, no POST /payments, the invoice stays
 *          open (QA recorded 2027-06-01 on 2026-11-19 and the customer was
 *          emailed "PAGADA 1 de junio de 2027")
 *   (q1-9) /payments with a payment dated in the future (one stored before
 *          the guard — served here by rewriting GET /api/payments) never
 *          reads "Today", is not counted in "showed up this month", and does
 *          not feed the average days to pay (QA saw "Hoy · INV-001",
 *          "$1,250 llegaron este mes" and "194d" next to an empty cash-flow
 *          card)
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
/** the browser's local calendar day `n` days from now */
const localDay = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Future Date Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  url: string,
  body: unknown,
) {
  const r = await http(url, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

/** a customer with one sent $1,250 invoice issued today */
async function seed(http: StoryTools["http"], auth: Record<string, string>) {
  const customer = await post(http, auth, "/api/customers", {
    name: `Randall Future ${digits()}`,
    email: "rb@blackhole.postmarkapp.com",
  });
  const inv = await post(http, auth, "/api/invoices", {
    customerId: customer.id,
    jobName: "Back fence",
    amount: 125000,
    status: "sent",
    issuedDate: localDay(0),
    dueDate: localDay(14),
  });
  return { customer, inv };
}

Deno.test("REQ-943 (q1-8): on the customer page, Record payment with a received date after today is refused inline — no POST, the invoice stays open", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const { customer, inv } = await seed(http, auth);
    let posts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/api\/payments$/.test(req.url())) {
        posts++;
      }
    });

    await page.goto(`/customers/${customer.id}`);
    await page.locator(
      `[data-cy='customer-workspace'][data-customer='${customer.id}']`,
    ).waitFor({ timeout: 20_000 });
    await page.locator("[data-cy='cws-record-payment']").click();
    const sheet = page.locator("[data-cy='cws-payment-sheet']");
    await sheet.locator("[data-cy='pay-received-form']").waitFor({
      timeout: 15_000,
    });
    await sheet.locator("[data-cy='pay-method-zelle']").click();
    await sheet.locator("[data-cy='pay-received-date']").fill(localDay(195));
    await sheet.locator("[data-cy='pay-received-submit']").click();

    const err = sheet.locator("[data-cy='pay-received-error']");
    await err.waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const errText = (await err.count()) > 0
      ? (await err.innerText()).replace(/\s+/g, " ").trim()
      : "";
    expect.eq(posts, 0, "no POST /payments for a future day");
    expect(
      errText.length > 0,
      `an inline reason is shown (got ${JSON.stringify(errText)})`,
    );
    const rows = await (await http(`/api/payments?invoiceId=${inv.id}`, {
      headers: auth,
    })).json();
    expect.eq(rows.length, 0, "no payment stored");
    const after = await (await http(`/api/invoices/${inv.id}`, {
      headers: auth,
    })).json();
    expect(after.status !== "paid", `the invoice stays open (${after.status})`);
  }));

Deno.test("REQ-943 (q1-9): /payments never shows a future-dated payment as 'Today', counts it this month, or averages it into days to pay", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const { inv } = await seed(http, auth);
    // a real payment today, then served to the page as one dated +200 days
    // (the shape QA's 2027-06-01 payment had in the store)
    const pay = await post(http, auth, "/api/payments", {
      invoiceId: inv.id,
      amount: 125000,
      method: "zelle",
      receivedAt: new Date().toISOString(),
    });
    const future = `${localDay(200)}T12:00:00.000Z`;
    await page.route(/\/api\/payments(\?.*)?$/, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const list = await res.json();
      const rows = Array.isArray(list)
        ? list.map((p: { id: string }) =>
          p.id === pay.id ? { ...p, receivedAt: future } : p
        )
        : list;
      await route.fulfill({ response: res, json: rows });
    });

    await page.goto("/payments");
    await page.locator("[data-cy='payments-kpi-avg']").waitFor({
      timeout: 20_000,
    });
    await page.waitForTimeout(500);
    const facts = await page.evaluate(() => ({
      body: document.body.innerText,
      hero: document.querySelector(".pph__title-amount")?.textContent ?? "",
      avg: document.querySelector("[data-cy='payments-kpi-avg'] .qkpi__val")
        ?.textContent?.trim() ?? "",
    }));
    // innerText applies text-transform, so the stub reads "TODAY · INV-001"
    const today = facts.body.match(/today\s*·[^\n]*/i)?.[0] ?? "";
    expect(
      today === "",
      `no 'Today · INV-…' line for a payment dated in the future (got "${today}")`,
    );
    expect(
      !facts.hero.includes("1,250"),
      `the hero does not count it as this month (hero "${facts.hero}")`,
    );
    expect(
      facts.avg !== "200d",
      `the average days to pay leaves it out (got "${facts.avg}")`,
    );
  }));
