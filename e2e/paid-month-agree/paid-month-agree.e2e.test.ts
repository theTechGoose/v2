/**
 * REQ-959 — LOOP-007 cycle 1, q1-34 [BUG_CONTRADICTION]: "Invoices and
 * Payments pages disagree on this month's money". Raphael: "test every
 * single aspect of this application … one Opus agent per issue to do root
 * cause analysis, then one to write the test, then one to fix it and make
 * it green."
 *
 * INV-001 ($2,490) is paid in full, INV-002 ($1,000) gets a $400 check,
 * both this month. /payments says $2,890 showed up this month; the
 * /invoices "Paid this month" tile must say the same money (REQ-551: every
 * "paid" KPI counts what was collected against the bill). Today it drops
 * the part payment and reads $2,490.
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
    body: JSON.stringify({ language: "en", name: "Paid Month Story" }),
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
  const json = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(json)}`);
  return json;
}

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function sentInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customerId: string,
  job: string,
  cents: number,
) {
  return await post(http, auth, "/api/invoices", {
    customerId,
    status: "sent",
    jobName: job,
    dueDate: inDays(7),
    lineItems: [{ description: job, quantity: 1, unit: "job", price: cents }],
    subtotalCents: cents,
    amount: cents,
  });
}

Deno.test("REQ-959 (q1-34): a $400 part payment counts on /invoices 'Paid this month' exactly as on the /payments hero", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Randall Belknap",
      email: "rb@blackhole.postmarkapp.com",
    });
    const inv1 = await sentInvoice(
      http,
      auth,
      customer.id,
      "Deck rebuild",
      249000,
    );
    const inv2 = await sentInvoice(http, auth, customer.id, "Gate", 100000);
    const now = new Date().toISOString();
    await post(http, auth, "/api/payments", {
      invoiceId: inv1.id,
      amount: 249000,
      method: "check",
      receivedAt: now,
    });
    await post(http, auth, "/api/payments", {
      invoiceId: inv2.id,
      amount: 40000,
      method: "check",
      receivedAt: now,
    });

    await page.goto("/payments");
    const hero = page.locator(".pph__title-amount");
    await hero.waitFor({ timeout: 20_000 });
    const heroText = await page.evaluate(() =>
      (document.querySelector(".pph__title-amount")?.textContent ?? "")
        .replace(/\s+/g, "")
    );
    expect.eq(heroText, "$2,890", "/payments hero: both payments count");

    await page.goto("/invoices");
    const paidCell = page.locator(".qkpi__cell", {
      has: page.locator(".qkpi__lbl", { hasText: "Paid this month" }),
    });
    await paidCell.locator(".qkpi__val").waitFor({ timeout: 20_000 });
    // wait for the invoices list to load (the tile starts at $0 before data)
    await page.locator(`text=Gate`).first().waitFor({ timeout: 20_000 })
      .catch(() => {});
    const tile = await page.evaluate(() => {
      const cells = [...document.querySelectorAll(".qkpi__cell")];
      const cell = cells.find((c) =>
        (c.querySelector(".qkpi__lbl")?.textContent ?? "").trim() ===
          "Paid this month"
      );
      return (cell?.querySelector(".qkpi__val")?.textContent ?? "")
        .replace(/\s+/g, "");
    });
    expect.eq(
      tile,
      heroText,
      "/invoices 'Paid this month' tile equals the /payments hero",
    );
  }));
