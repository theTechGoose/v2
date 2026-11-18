/**
 * REQ-930 — Raphael: "when i mark an invoice as paid, i need a modal to put
 * the reference number." In a browser: the owner's confirm buttons open the
 * Mark as paid modal; what is typed there is the payment's reference.
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
    body: JSON.stringify({ language: "en", name: "Mark Paid Story" }),
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

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

/** a sent invoice for a new customer that the customer claimed by Zelle, ref ZL-930 */
async function claimedInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  job: string,
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Rita Reference",
      email: "rita.reference@blackhole.postmarkapp.com",
    }),
  })).json();
  const today = new Date().toISOString().slice(0, 10);
  const inv = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      jobName: job,
      lineItems: [{ description: job, quantity: 1, unit: "job", price: 30000 }],
      amount: 30000,
      status: "sent",
      issuedDate: today,
      dueDate: today,
    }),
  })).json();
  const claim = await http(`/api/invoices/${inv.id}/claim-payment`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ method: "zelle", reference: "ZL-930" }),
  });
  if (claim.status !== 200) throw new Error(`claim: ${claim.status}`);
  await claim.body?.cancel();
  return inv as { id: string };
}

async function invoiceState(
  http: StoryTools["http"],
  auth: Record<string, string>,
  id: string,
) {
  const inv = await (await http(`/api/invoices/${id}`, { headers: auth }))
    .json();
  const rows = await (await http(`/api/payments?invoiceId=${id}`, {
    headers: auth,
  })).json() as { reference?: string }[];
  // JSON: expect.eq compares with ===
  return JSON.stringify({
    status: inv.status as string,
    refs: rows.map((r) => r.reference),
  });
}

const dialog = "[data-cy='mark-paid-dialog']";

Deno.test("REQ-930: Confirm payment on a claimed /invoices card opens the Mark as paid modal (prefilled with the claim's ref); the typed reference is the one recorded; Cancel records nothing", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const job = `Hedge trim ${digits()}`;
    const inv = await claimedInvoice(http, auth, job);

    await page.goto("/invoices");
    const card = page.locator("article.qcard", { hasText: job });
    const cta = card.locator("[data-cy='invoice-cta-claimed']");
    await cta.waitFor({ timeout: 15_000 });

    // 1. Cancel: the modal closes and nothing is recorded
    await clickUntil(
      page,
      `article.qcard:has-text("${job}") [data-cy='invoice-cta-claimed']`,
      async () => (await page.locator(dialog).count()) === 1,
    );
    const field = page.locator("[data-cy='mark-paid-reference']");
    expect.eq(await field.inputValue(), "ZL-930", "prefilled with the claim's");
    expect.eq(
      await field.evaluate((el) => el === document.activeElement),
      true,
      "the reference field has the focus",
    );
    await page.locator("[data-cy='mark-paid-cancel']").click();
    await page.locator(dialog).waitFor({ state: "detached", timeout: 5_000 });
    expect.eq(
      await invoiceState(http, auth, inv.id),
      JSON.stringify({ status: "claimed", refs: [] }),
      "Cancel records nothing",
    );

    // 2. Mark as paid with the owner's own reference
    await cta.click();
    await field.waitFor({ timeout: 5_000 });
    await field.fill("CHK-1042");
    await page.locator("[data-cy='mark-paid-confirm']").click();
    await page.locator("[data-cy='payment-confirmed']").waitFor({
      timeout: 15_000,
    });
    expect.eq(await page.locator(dialog).count(), 0, "the modal closed");
    expect.eq(
      await invoiceState(http, auth, inv.id),
      JSON.stringify({ status: "paid", refs: ["CHK-1042"] }),
      "the typed reference is recorded on the payment",
    );
  }));

Deno.test("REQ-930: Got it on a /payments claim card goes through the Mark as paid modal too", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await claimedInvoice(http, auth, `Leaf cleanup ${digits()}`);
    await page.goto("/payments");
    await page.locator("[data-cy='payment-claim']").first().waitFor({
      timeout: 15_000,
    });
    await clickUntil(
      page,
      "[data-cy='payment-claim-confirm']",
      async () => (await page.locator(dialog).count()) === 1,
    );
    const field = page.locator("[data-cy='mark-paid-reference']");
    expect.eq(await field.inputValue(), "ZL-930", "prefilled with the claim's");
    await field.fill("BANK-77");
    await page.locator("[data-cy='mark-paid-confirm']").click();
    await page.locator("[data-cy='payment-claim']").first().waitFor({
      state: "detached",
      timeout: 15_000,
    });
    expect.eq(
      await invoiceState(http, auth, inv.id),
      JSON.stringify({ status: "paid", refs: ["BANK-77"] }),
      "the typed reference is recorded on the payment",
    );
  }));
