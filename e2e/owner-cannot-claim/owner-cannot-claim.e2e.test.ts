/**
 * REQ-479 — demo-loop cycle 3, issue M30: the owner's own browser on her
 * invoice link (/i/:id) tapped Zelle → "Ya lo envié" and filed "the customer
 * paid" on her own invoice. In a browser:
 *  - the owner's tab shows "Preview — you are viewing as the customer" and a
 *    "Record a payment you received" link to /invoices?open=…&pay=1, never
 *    the payment-method chips;
 *  - a direct claim POST from the owner's session is 409 owner_cannot_claim
 *    and the invoice stays unclaimed;
 *  - the customer (no session) still sees the chips and claims.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function seed(http: StoryTools["http"]) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const call = async (path: string, payload: unknown, method = "POST") => {
    const res = await http(path, {
      method,
      headers: auth,
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  };
  await call("/api/me", { name: "Claim Owner", language: "en" }, "PUT");
  await call("/api/profile/identity", {
    businessName: "Zelle Builders",
    acceptedPaymentMethods: { zelle: { enabled: true, handle: "z@x.com" } },
  }, "PUT");
  const customer = await call("/api/customers", {
    name: "Juan Pérez",
    email: "juan@blackhole.postmarkapp.com",
  });
  const invoice = await call("/api/invoices", {
    customerId: customer.id,
    status: "sent",
    jobName: "Fence repair REQ-479",
    description: "Fence repair REQ-479",
    lineItems: [{ description: "Fence repair", quantity: 1, price: 48000 }],
    amount: 48000,
    dueDate: "2026-12-05",
  });
  return { cookie, auth, invoiceId: invoice.id as string };
}

Deno.test("REQ-479 M30: the owner's /i/:id is a preview with 'Record a payment you received' (no claim chips), her claim POST is 409 owner_cannot_claim; the customer still claims", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { cookie, auth, invoiceId } = await seed(http);
    const [name, value] = cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].flatMap((domain) => [
        { name, value, domain, path: "/" },
        { name: "pm_lang", value: "en", domain, path: "/" },
      ]),
    );
    await page.setViewportSize({ width: 1280, height: 900 });

    // 1. the owner's own browser: a preview, never the claim chips
    await page.goto(`/i/${invoiceId}`);
    await page.locator("[data-cy=invoice-internal-preview]").waitFor({
      timeout: 15_000,
    });
    await expect.see("viewing as the customer");
    expect.eq(
      await page.locator("[data-cy=claim-method-zelle]").count(),
      0,
      "no Zelle chip for the owner",
    );
    const record = page.locator("[data-cy=invoice-record-payment]");
    expect.eq(
      await record.innerText(),
      "Record a payment you received",
      "the owner's action is recording a payment",
    );
    expect.eq(
      await record.getAttribute("href"),
      `/invoices?open=${invoiceId}&pay=1`,
      "it opens the invoice on Payment received",
    );

    // 2. the owner's session cannot file the claim by hand either
    const direct = await http(`/api/invoices/${invoiceId}/claim-payment`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ method: "zelle", reference: "ZL-479" }),
    });
    const directBody = await direct.json().catch(() => ({}));
    expect.eq(direct.status, 409, "the owner's claim is refused");
    expect.eq(directBody.reason, "owner_cannot_claim", "with its reason");
    const after = await http(`/api/invoices/${invoiceId}/public`).then((r) =>
      r.json()
    );
    expect.eq(after.status, "sent", "the invoice is still unclaimed");

    // 3. the customer: no session — the chips, and the claim lands
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const customerCtx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    try {
      const cx = await customerCtx.newPage();
      await cx.goto(`${baseUrl}/i/${invoiceId}?lang=en`);
      await cx.locator("[data-cy=claim-method-zelle]").waitFor({
        timeout: 15_000,
      });
      expect.eq(
        await cx.locator("[data-cy=invoice-internal-preview]").count(),
        0,
        "the customer sees no preview banner",
      );
      // click until the island has hydrated and the claim lands, 2 s a try
      const thanks = cx.locator("[data-cy=claim-thanks]");
      for (let i = 0; i < 10 && !(await thanks.count()); i++) {
        try {
          await cx.locator("[data-cy=claim-method-zelle]").click({
            timeout: 2_000,
          });
          await cx.locator("[data-cy=claim-submit]").click({ timeout: 2_000 });
          await thanks.waitFor({ timeout: 2_000 });
        } catch { /* not hydrated yet */ }
      }
      await thanks.waitFor({ timeout: 15_000 });
    } finally {
      await customerCtx.close();
    }
  }));
