/**
 * The invoice polish of 2026-11-05 (REQ-161 …), on the real shell: the PDF
 * download, the per-invoice delete, the business website, the closing copy.
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
    body: JSON.stringify({ language: "en", name: "Invoice Story" }),
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

async function mkInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Randall Belknap",
      email: "rb@blackhole.postmarkapp.com",
    }),
  })).json();
  const inv = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      status: "draft",
      jobName: "Maintenance 2026-10-01 → 2026-10-31",
      description: "Oct 2 — Lawn — 725 Frederick Rd, Rockingham, VA",
      lineItems: [{
        description: "Oct 2 — Lawn — 725 Frederick Rd, Rockingham, VA",
        quantity: 1,
        unit: "visit",
        price: 6500,
      }],
      amount: 6500,
      ...extra,
    }),
  })).json();
  return { customer, inv };
}

Deno.test("REQ-161: an invoice titled 'Maintenance 2026-10-01 → 2026-10-31' downloads as a PDF (200, application/pdf) instead of a 500", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { inv } = await mkInvoice(http, auth);
    const r = await http(`/api/invoices/${inv.id}/pdf`, { headers: auth });
    const detail = r.status === 200 ? "" : (await r.text()).slice(0, 120);
    expect.eq(r.status, 200, `Download PDF answers 200 (${detail})`);
    if (r.status !== 200) return;
    expect(
      (r.headers.get("content-type") ?? "").includes("application/pdf"),
      `content-type is application/pdf (${r.headers.get("content-type")})`,
    );
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect.eq(
      new TextDecoder().decode(bytes.slice(0, 5)),
      "%PDF-",
      "the body is a PDF",
    );
  }));

Deno.test("REQ-167: an invoice can be deleted from its detail card and from its list card — it asks first, then it is gone", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { inv } = await mkInvoice(http, auth, {
      jobName: "Delete me from the detail",
    });
    await page.goto(`/invoices?open=${inv.id}`);
    await page.locator("[data-cy='invoice-delete']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='invoice-delete']").click();
    await page.locator("[data-cy='invoice-delete-confirm']").click();
    await page.locator("[data-cy='invoice-edit']").waitFor({
      state: "hidden",
      timeout: 15_000,
    });
    const gone = await http(`/api/invoices/${inv.id}`, { headers: auth });
    await gone.body?.cancel();
    expect.eq(gone.status, 404, "the invoice is gone from the API");

    const { inv: inv2 } = await mkInvoice(http, auth, {
      jobName: "Delete me from the card",
    });
    await page.goto("/invoices");
    const card = page.locator(".qcard", {
      has: page.locator("[data-cy='invoice-card-job']", {
        hasText: "Delete me from the card",
      }),
    });
    await card.waitFor({ timeout: 15_000 });
    await card.click(); // the card flips; its actions (adjust, delete) live on the back
    await card.locator("[data-cy='invoice-card-delete']").click();
    await card.locator("[data-cy='invoice-card-delete-confirm']").click();
    await page.locator("[data-cy='invoice-card-job']", {
      hasText: "Delete me from the card",
    }).waitFor({ state: "hidden", timeout: 15_000 });
    const gone2 = await http(`/api/invoices/${inv2.id}`, { headers: auth });
    await gone2.body?.cancel();
    expect.eq(gone2.status, 404, "the second invoice is gone from the API");
  }));

Deno.test("REQ-168/169: the public invoice links the business website and thanks the customer for trusting the business", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const ident = await http("/api/profile/identity", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        businessName: "A2Z Landscape LLC",
        websiteUrl: "https://a2zlandscape.com",
      }),
    });
    expect.eq(ident.status, 200, "identity saved");
    await ident.body?.cancel();
    const { inv } = await mkInvoice(http, auth);
    await page.goto(`/i/${inv.id}`);
    const site = page.locator("[data-cy='invoice-website']");
    await site.waitFor({ timeout: 15_000 });
    expect.eq(
      await site.getAttribute("href"),
      "https://a2zlandscape.com",
      "the website link points at the business site",
    );
    await expect.see("a2zlandscape.com");
    await expect.see("Thank you for trusting A2Z Landscape LLC");
    await expect.notSee("I look forward to working with you");
  }));

Deno.test("REQ-173: a batch invoice's public page shows each address as a heading with the date and service of every visit under it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const addr = "725 Frederick Rd, Rockingham, VA 22801-1306";
    const { inv } = await mkInvoice(http, auth, {
      description: `Oct 2 — Lawn — ${addr}\nOct 9 — Lawn — ${addr}`,
      lineItems: [
        {
          description: `Oct 2 — Lawn — ${addr}`,
          quantity: 1,
          unit: "visit",
          price: 6500,
          date: "2026-10-02",
          service: "Lawn",
          address: addr,
        },
        {
          description: `Oct 9 — Lawn — ${addr}`,
          quantity: 1,
          unit: "visit",
          price: 6500,
          date: "2026-10-09",
          service: "Lawn",
          address: addr,
        },
      ],
      amount: 13000,
    });
    await page.goto(`/i/${inv.id}`);
    const heading = page.locator("[data-cy='invoice-visit-address']");
    await heading.first().waitFor({ timeout: 15_000 });
    expect.eq(await heading.count(), 1, "one address heading");
    expect.eq(
      (await heading.first().innerText()).trim(),
      addr,
      "the heading is the address",
    );
    const rows = page.locator("[data-cy='invoice-visit']");
    expect.eq(await rows.count(), 2, "one row per visit");
    expect(
      (await rows.nth(0).innerText()).includes("Oct 2") &&
        (await rows.nth(0).innerText()).includes("Lawn"),
      `the first row reads date · service (${await rows.nth(0).innerText()})`,
    );
    await expect.see("$65.00");
    await expect.notSee(`Oct 2 — Lawn — ${addr}`);
  }));
