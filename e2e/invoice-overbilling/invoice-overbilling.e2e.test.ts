/**
 * REQ-233 (demo issue B2) on the real app — one $2,400 job was billed $4,800.
 * The customer signed the 50/50 quote on /q (the accept bills INV-001 $1,200
 * sent + INV-002 $1,200 scheduled); then the assistant's "Send as Invoice"
 * swap POSTed /api/invoices { quoteId, amount: 240000 } and a third,
 * full-amount invoice was saved.
 *
 * Now a quote-linked invoice bills at most what the agreement still has
 * unbilled: the swap's request is a 409 `exceeds_agreement`, and the invoice
 * form on the signed quote says so in a sentence instead of saving a third
 * invoice.
 *
 * Pages: /q/[id] accept (backend public-controller → SendSignedConfirmation),
 * /invoices?new=1&quoteId= (front-end/islands/InvoicesPage.tsx), the guard in
 * backend/src/paperwork/entrypoints/invoice-controller/mod.ts and
 * shared/documents/ledger.ts.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

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
    body: JSON.stringify({ language: "en", name: "Overbilling Story" }),
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

/** A $2,400 50/50 quote, signed by the customer on /q. */
async function signedFiftyFifty(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Dana Whitfield",
      email: "dana.whitfield@blackhole.postmarkapp.com",
      phoneNumber: "+15125550233",
    }),
  })).json();
  const quote = await (await http("/api/quotes", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      summary: "Interior paint — 3 rooms",
      jobName: "Interior paint",
      customerId: customer.id,
      lineItems: [{
        description: "Paint 3 rooms",
        quantity: 1,
        unit: "job",
        price: 240000,
      }],
      estimatedTotal: 240000,
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50 / 50",
      }],
      status: "sent",
    }),
  })).json();
  const accept = await http(`/api/quotes/${quote.id}/accept`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "Dana Whitfield", signature: SIGNATURE_PNG }),
  });
  await accept.body?.cancel();
  if (accept.status >= 400) throw new Error(`accept: ${accept.status}`);
  return { quoteId: quote.id as string, customerId: customer.id as string };
}

async function dealInvoices(
  http: StoryTools["http"],
  auth: Record<string, string>,
  quoteId: string,
) {
  const all = await (await http("/api/invoices", { headers: auth }))
    .json() as Array<{ quoteId?: string; amount?: number; status?: string }>;
  return all.filter((i) =>
    i.quoteId === quoteId && i.status !== "void" && i.status !== "canceled"
  );
}

Deno.test("REQ-233 B2: after the customer signs a 50/50 $2,400 quote, the assistant's 'Send as Invoice' request for the full $2,400 is refused (409 exceeds_agreement) — the job stays billed at $2,400, not $4,800", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quoteId, customerId } = await signedFiftyFifty(http, auth);
    const before = await dealInvoices(http, auth, quoteId);
    expect.eq(
      before.map((i) => i.amount).join(" + "),
      "120000 + 120000",
      "signing billed the deposit and the balance",
    );

    // exactly the body confirmSendInvoiceSwap posts
    const third = await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId,
        quoteId,
        amount: 240000,
        issuedDate: new Date().toISOString().slice(0, 10),
        status: "sent",
      }),
    });
    const refusal = await third.json();
    expect.eq(third.status, 409, "a third, full-amount invoice is refused");
    expect.eq(refusal.reason, "exceeds_agreement", "with a readable reason");
    expect.eq(refusal.remainingCents, 0, "nothing is left to invoice");

    const after = await dealInvoices(http, auth, quoteId);
    expect.eq(
      after.reduce((s, i) => s + (i.amount ?? 0), 0),
      240000,
      "the job is billed $2,400 in total",
    );
  }));

Deno.test("REQ-233: the invoice form on a signed, fully billed quote says the amount is more than is left to invoice and saves no third invoice", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quoteId } = await signedFiftyFifty(http, auth);
    await page.goto(`/invoices?new=1&quoteId=${quoteId}`);
    const ledger = page.locator("[data-cy='new-invoice-ledger']");
    await ledger.waitFor({ timeout: 15_000 });
    const ledgerText = await ledger.innerText();
    expect(
      ledgerText.includes("Remaining $0.00"),
      `the ledger shows nothing left (${ledgerText})`,
    );
    await page.locator("[data-cy='new-invoice-amount']").fill("2400");
    await page.locator("[data-cy='new-invoice-draft']").click();
    await expect.see(
      "That amount is more than what's left to invoice on this agreement.",
      { timeout: 15_000 },
    );
    expect.eq(
      (await dealInvoices(http, auth, quoteId)).length,
      2,
      "no third invoice was saved",
    );
  }));
