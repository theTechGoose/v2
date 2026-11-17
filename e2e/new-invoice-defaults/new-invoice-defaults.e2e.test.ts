/**
 * REQ-483 (demo-loop cycle 3, M40 + m18) on the real app — the New invoice
 * modal (/invoices?new=1, front-end/islands/InvoicesPage.tsx NewInvoiceModal)
 * starts from what the account already said:
 *   M40: the payment methods saved at onboarding (identity
 *        acceptedPaymentMethods: Zelle 5125550102 + Cash) fill "Payment
 *        instructions" when Settings has no text of its own;
 *   m18: the terms are Settings' "Days to pay an invoice" (invoiceNetDays),
 *        or — opened from a quote — that quote's payment terms (Due now → 0),
 *        never a hard-coded Net 30.
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
    body: JSON.stringify({ language: "en", name: "Defaults Story" }),
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

async function saveIdentity(
  http: StoryTools["http"],
  auth: Record<string, string>,
  patch: Record<string, unknown>,
) {
  const r = await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify(patch),
  });
  const text = await r.text();
  if (r.status >= 400) throw new Error(`identity: ${r.status} ${text}`);
}

async function valueOf(
  page: StoryTools["page"],
  sel: string,
  want: string,
): Promise<string> {
  await page.locator(sel).waitFor({ timeout: 15_000 });
  try {
    await page.waitForFunction(
      ([s, w]) =>
        (document.querySelector(s) as HTMLInputElement | null)?.value === w,
      [sel, want] as const,
      { timeout: 15_000 },
    );
  } catch { /* the assertion below reports what it holds */ }
  return await page.locator(sel).inputValue();
}

Deno.test("REQ-483 M40 + m18: onboarding's Zelle + Cash and Settings' 15 days to pay → a standalone New invoice opens with 'Zelle: +1 (512) 555-0102 · Cash' (REQ-593 formats the number) and Net 15, not an empty field and Net 30", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await saveIdentity(http, auth, {
      businessName: "Sparkle Home Cleaning",
      invoiceNetDays: 15,
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "5125550102" },
        cash: { enabled: true },
      },
    });
    await page.goto("/invoices?new=1");
    expect.eq(
      await valueOf(
        page,
        "[data-cy='new-invoice-payment-instructions']",
        "Zelle: +1 (512) 555-0102 · Cash",
      ),
      "Zelle: +1 (512) 555-0102 · Cash",
      "Payment instructions start from the onboarding methods",
    );
    expect.eq(
      await valueOf(page, "[data-cy='new-invoice-terms']", "15"),
      "15",
      "the terms start at Settings' 15 days",
    );
  }));

Deno.test("REQ-483 m18: a New invoice drawn from a 'Due Now' quote opens with Due now terms (0 days), not Net 30", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Dana Whitfield",
        email: "dana.whitfield@blackhole.postmarkapp.com",
      }),
    })).json();
    const quote = await (await http("/api/quotes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        summary: "Deep clean",
        jobName: "Deep clean",
        customerId: customer.id,
        lineItems: [{
          description: "Deep clean",
          quantity: 1,
          unit: "job",
          price: 45000,
        }],
        estimatedTotal: 45000,
        terms: [{
          stepId: "payment_terms",
          label: "Payment terms",
          value: "Due Now",
        }],
      }),
    })).json();
    await page.goto(`/invoices?new=1&quoteId=${quote.id}`);
    await page.locator("[data-cy='new-invoice-ledger']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await valueOf(page, "[data-cy='new-invoice-terms']", "0"),
      "0",
      "the terms follow the quote's Due now",
    );
  }));
