/**
 * REQ-678 — demo-loop cycle 5, issue c3-m60: "'Deposit + balance' never asks
 * the amount; silently 20%". On the payment step the contractor taps
 * "Deposit + balance", is asked "How much upfront?" (10 / 20 / 30 / 50 % or a
 * custom $), picks 30%, and that deposit is what the quote stores and the
 * signature bills.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const TOTAL = 1_450_000;

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
    body: JSON.stringify({ language: "en", name: "Tom Baker" }),
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
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

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
      // not clickable yet (hydrating) or already gone: the polls decide
    }
    for (let i = 0; i < 10; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

/** The customer, as the anonymous /q page signs (no session). */
async function customerSigns(http: StoryTools["http"], quoteId: string) {
  const r = await http(`/api/quotes/${quoteId}/accept`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "Linda Ortiz", signature: "Linda Ortiz" }),
  });
  return { status: r.status, body: await r.json() };
}

/** A priced, locked quote whose terms wizard waits on the payment step. */
async function lockedMidWizard(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await post(http, auth, "/api/customers", {
    name: "Linda Ortiz",
    email: `linda.ortiz.${digits()}@blackhole.postmarkapp.com`,
  });
  const quote = await post(http, auth, "/api/quotes", {
    customerId: customer.id,
    summary: "Roof replacement",
    jobName: "Roof replacement",
    lineItems: [{
      description: "Roof replacement",
      quantity: 1,
      unit: "job",
      price: TOTAL,
    }],
    estimatedTotal: TOTAL,
    status: "draft",
  });
  const conv = await post(http, auth, "/api/agents/conversations", {
    quoteId: quote.id,
    customerId: customer.id,
  });
  const convId = (conv.id ?? conv.conversation?.id) as string;
  await post(http, auth, `/api/agents/conversations/${convId}/lock-quote`, {
    quoteId: quote.id,
  });
  await post(
    http,
    auth,
    `/api/agents/conversations/${convId}/transition-to-terms`,
    {},
  );
  const answer = (stepId: string, optionId: string) =>
    post(http, auth, "/api/agents/wizard/answer", {
      conversationId: convId,
      stepId,
      optionId,
    });
  await answer("customer", "use_active");
  await answer("start_date", "next_week");
  await answer("wraps", "2_3_days");
  return { quote, convId, answer };
}

Deno.test("REQ-678 (demo-loop cycle 5, c3-m60): 'Deposit + balance' asks how much upfront — 30% lands on the quote and the signature bills $4,350 + $10,150", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quote, convId, answer } = await lockedMidWizard(http, auth);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${convId}`);
    const deposit = ".wiz__opts .wiz-opt:has-text('Deposit + balance')";
    await page.locator(deposit).first().waitFor({ timeout: 20_000 });
    const picker = page.locator("[data-testid='deposit-pick']");
    await clickUntil(page, deposit, async () => (await picker.count()) > 0);

    const text = await picker.innerText();
    expect(/how much upfront/i.test(text), `the picker asks: "${text}"`);
    for (const pct of [10, 20, 30, 50]) {
      expect.eq(
        await page.locator(`[data-testid='deposit-pick-${pct}']`).count(),
        1,
        `a ${pct}% chip`,
      );
    }
    expect(
      text.includes("$4,350 now · $10,150 when done"),
      `the 30% chip names its dollars: "${text}"`,
    );
    expect.eq(
      await page.locator("[data-testid='deposit-pick-custom']").count(),
      1,
      "a custom $ chip",
    );

    type Term = { stepId: string; value: string };
    const payTerm = async () =>
      (((await (await http(`/api/quotes/${quote.id}`, { headers: auth }))
        .json()).terms ?? []) as Term[])
        .find((x) => x.stepId === "payment_terms")?.value;
    await clickUntil(
      page,
      "[data-testid='deposit-pick-30']",
      async () => (await payTerm()) === "Deposit 30% + balance",
    );
    // the thread's pick line names the amount
    await page.getByText("Payment: Deposit 30% + balance").first().waitFor({
      timeout: 15_000,
    });

    // the rest of the wizard, the send, and the customer's signature
    await answer("warranty", "12_months");
    await post(http, auth, `/api/agents/conversations/${convId}/send-quote`, {
      quoteId: quote.id,
      channel: "email",
      language: "en",
    });
    const signed = await customerSigns(http, quote.id);
    expect.eq(signed.status, 200, `the customer signs (${signed.body.reason})`);
    const invoices = (await (await http("/api/invoices", { headers: auth }))
      .json() as { quoteId?: string; amount?: number }[])
      .filter((i) => i.quoteId === quote.id);
    expect.eq(
      invoices.map((i) => i.amount).sort((a, b) => (a ?? 0) - (b ?? 0))
        .join(" + "),
      "435000 + 1015000",
      "the deposit invoice is the 30% picked, not a silent 20%",
    );
  }));
