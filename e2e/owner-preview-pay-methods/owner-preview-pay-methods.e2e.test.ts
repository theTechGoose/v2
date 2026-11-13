/**
 * REQ-705 — demo-loop cycle 5, issue m68 "No payment methods on the owner's
 * invoice preview". The owner's own /i/:id says "Preview — you are viewing as
 * the customer", so it must list the payment methods the customer sees
 * (read-only, nothing to tap), not a page with no methods at all.
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
    businessName: "Zelle Cash Builders",
    acceptedPaymentMethods: {
      zelle: { enabled: true, handle: "z@x.com" },
      cash: { enabled: true },
    },
  }, "PUT");
  const customer = await call("/api/customers", {
    name: "Juan Pérez",
    email: "juan@blackhole.postmarkapp.com",
  });
  const invoice = await call("/api/invoices", {
    customerId: customer.id,
    status: "sent",
    jobName: "Fence repair REQ-705",
    description: "Fence repair REQ-705",
    lineItems: [{ description: "Fence repair", quantity: 1, price: 48000 }],
    amount: 48000,
    dueDate: "2026-12-05",
  });
  return { cookie, auth, invoiceId: invoice.id as string };
}

Deno.test("REQ-705 m68: the owner's /i/:id preview lists the accepted methods (Zelle, Cash) read-only", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { cookie, invoiceId } = await seed(http);
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

    await page.goto(`/i/${invoiceId}`);
    await page.locator("[data-cy=invoice-internal-preview]").waitFor({
      timeout: 15_000,
    });
    const list = page.locator("[data-cy=invoice-preview-methods]");
    await list.waitFor({ timeout: 15_000 });
    const zelle = page.locator("[data-cy=invoice-preview-method-zelle]");
    const cash = page.locator("[data-cy=invoice-preview-method-cash]");
    expect.eq((await zelle.innerText()).trim(), "Zelle", "Zelle is listed");
    expect.eq((await cash.innerText()).trim(), "Cash", "Cash is listed");
    expect.eq(await zelle.isDisabled(), true, "a preview chip is read-only");
    expect.eq(
      await page.locator("[data-cy=claim-method-zelle]").count(),
      0,
      "still no live claim chip for the owner",
    );
  }));
