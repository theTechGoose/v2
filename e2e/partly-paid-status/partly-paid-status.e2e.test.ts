/**
 * REQ-1073 — LOOP-007 cycle 2, issue q2-62 [minor/BUG_CONTRADICTION]: "One
 * part-paid invoice shows four different statuses across screens". QA (in
 * Spanish) issued INV-001 for $1,190.75 and recorded $500, then read:
 *   customer Invoices tab  "Pago parcial"
 *   /invoices card         "Enviada"
 *   header search          "INV-001 · Factura / $1,190.75 / Enviada"
 *   /i pill                "PENDIENTE"
 * All four must say "Pago parcial", and the search hit must show the $690.75
 * still owed. One page.evaluate per screen reads the label it shows.
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
    body: JSON.stringify({ language: "es", name: "Partly Paid Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  return { auth };
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

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const clean = (s: string | null | undefined) =>
  (s ?? "").replace(/\s+/g, " ").trim();

Deno.test("REQ-1073 (LOOP-007 q2-62): a $500 payment on a $1,190.75 invoice reads 'Pago parcial' on the customer tab, the /invoices card, the header search (with $690.75 owed) and /i", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const name = `Parcial ${digits()}`;
    const job = `Repintar cocina ${digits()}`;
    const customer = await post(http, auth, "/api/customers", {
      name,
      email: "parcial@blackhole.postmarkapp.com",
    });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: job,
      amount: 119075,
      status: "sent",
      issuedDate: inDays(-1),
      dueDate: inDays(14),
    });
    await post(http, auth, "/api/payments", {
      invoiceId: inv.id,
      amount: 50000,
      method: "check",
      receivedAt: new Date().toISOString().slice(0, 10),
    });
    const after = await (await http(`/api/invoices/${inv.id}`, {
      headers: auth,
    })).json();
    expect.eq(after.status, "pending", "the stored status after a part payment");

    // (1) customer Invoices tab
    await page.goto(`/customers/${customer.id}?tab=invoices`);
    const rowSel = `[data-cy='cws-invoice-row'][data-id='${inv.id}']`;
    await page.locator(`${rowSel} .cws-pill`).waitFor({ timeout: 20_000 });
    const tab = await page.evaluate(
      (sel) => document.querySelector(`${sel} .cws-pill`)?.textContent,
      rowSel,
    );

    // (2) /invoices card
    await page.goto("/invoices");
    const card = page.locator("article.qcard", {
      has: page.locator("[data-cy='invoice-card-job']", { hasText: job }),
    }).first();
    await card.locator(".qcard__status").waitFor({ timeout: 20_000 });
    const cardStatus = await card.evaluate((el) =>
      el.querySelector(".qcard__status")?.textContent
    );

    // (3) header search
    const input = page.locator("[data-cy='global-search-input']");
    await input.waitFor({ timeout: 15_000 });
    await input.fill(inv.number);
    const panel =
      `[data-cy='global-search-results'][data-state='ready'][data-q='${inv.number}']`;
    const hitSel =
      `${panel} [data-cy='global-search-row'][data-type='invoice'][data-id='${inv.id}']`;
    await page.locator(hitSel).waitFor({ timeout: 15_000 });
    const hit = await page.evaluate((sel) => {
      const row = document.querySelector(sel);
      return {
        status: row?.querySelector(".gsearch__status")?.textContent ?? null,
        meta: row?.querySelector(".gsearch__meta")?.textContent ?? null,
      };
    }, hitSel);

    // (4) /i — the business's own view of the public invoice
    await page.goto(`/i/${inv.id}`);
    await page.locator("[data-status-pill]").first().waitFor({
      timeout: 20_000,
    });
    const iPill = await page.evaluate(() =>
      document.querySelector("[data-status-pill]")?.textContent
    );

    const seen = {
      customerTab: clean(tab),
      invoicesCard: clean(cardStatus),
      search: clean(hit.status),
      publicInvoice: clean(iPill),
    };
    expect.eq(seen.customerTab, "Pago parcial", "customer Invoices tab pill");
    expect.eq(seen.invoicesCard, "Pago parcial", `/invoices card status (all: ${JSON.stringify(seen)})`);
    expect.eq(seen.search, "Pago parcial", `header search status (all: ${JSON.stringify(seen)})`);
    expect.eq(seen.publicInvoice.toLowerCase(), "pago parcial", `/i pill (all: ${JSON.stringify(seen)})`);
    expect.eq(
      clean(hit.meta).includes("$690.75"),
      true,
      `the search hit shows the $690.75 still owed (got "${clean(hit.meta)}")`,
    );
  }));
