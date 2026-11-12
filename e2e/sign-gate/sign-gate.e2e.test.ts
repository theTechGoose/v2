/**
 * REQ-460 — demo-loop cycle 3, pair 4 (Tom Baker, roofer), issues M16, M15
 * and B1. Tom clicked "Lock it in"; "Customer link · Open as customer"
 * appeared at once; /q said "AWAITING SIGNATURE" and Linda signed in person
 * while the assistant was still asking "When do you want to get paid?". The
 * signature billed the whole $14,500 as one invoice marked Sent (M15); Tom
 * then picked "Deposit + balance" and the SIGNED agreement showed the new
 * payment terms while "Pay now" still asked for $14,500 (B1).
 *
 *   M16/M15: a locked quote still in its terms wizard shows no customer link,
 *            its /q page offers no pad and no "Sign in person", the accept is
 *            refused (409 not_issued); once the terms are done and it is
 *            sent, the card carries the link and the signature bills 50/50.
 *   B1:      a wizard answer after the signature (Back to the payment step,
 *            then "Deposit + balance") writes nothing — the chat says a
 *            change needs a change order or a new version, and the question
 *            does not come back.
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

/** Tom's path up to the demo's moment: a priced quote, "Lock it in", the
 *  terms wizard answered for customer, start and duration — the payment
 *  question is the one still open. */
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

async function finishAndSend(
  http: StoryTools["http"],
  auth: Record<string, string>,
  convId: string,
  quoteId: string,
  answer: (stepId: string, optionId: string) => Promise<unknown>,
) {
  await answer("payment_terms", "50_50");
  await answer("warranty", "12_months");
  await post(http, auth, `/api/agents/conversations/${convId}/send-quote`, {
    quoteId,
    channel: "email",
    language: "en",
  });
}

Deno.test("REQ-460 (demo-loop cycle 3, M16 + M15): a locked quote still in its terms wizard has no customer link, its /q offers no pad or 'Sign in person', and the accept is refused; once sent, the card carries the link and the signature bills 50/50", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quote, convId, answer } = await lockedMidWizard(http, auth);

    // the assistant: the locked card and the open payment question, no link
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${convId}`);
    await page.locator(".action-card").first().waitFor({ timeout: 20_000 });
    await page.locator(".wiz__opts .wiz-opt").first().waitFor({
      timeout: 20_000,
    });
    await page.waitForTimeout(800); // the island's own read of the quote row
    expect.eq(
      await page.locator("[data-cy='customer-link']").count(),
      0,
      "no 'Customer link · Open as customer' while the quote is being finished",
    );

    // the owner's /q, plain and with the in-person override: not ready
    for (const query of ["", "?as=customer&confirm=1"]) {
      await page.goto(`/q/${quote.id}${query}`);
      await page.locator("[data-cy='quote-not-ready']").waitFor({
        timeout: 15_000,
      });
      expect.eq(
        await page.locator("[data-cy='quote-sign-in-person']").count(),
        0,
        `no 'Sign in person' (${query || "plain"})`,
      );
      expect.eq(
        await page.locator("form.ctr__sign-form").count(),
        0,
        `no signature pad (${query || "plain"})`,
      );
    }

    // the server refuses the customer and the owner's in-person override
    const early = await customerSigns(http, quote.id);
    expect.eq(early.status, 409, "the customer cannot sign it yet");
    expect.eq(early.body.reason, "not_issued", "reason not_issued");
    const inPerson = await http(
      `/api/quotes/${quote.id}/accept?as=customer&confirm=1`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Linda Ortiz", signature: "Linda" }),
      },
    );
    const inPersonBody = await inPerson.json();
    expect.eq(inPerson.status, 409, "nor in person through the owner");
    expect.eq(inPersonBody.reason, "not_issued", "reason not_issued");

    // the terms are finished and the quote is sent
    await finishAndSend(http, auth, convId, quote.id, answer);

    await page.goto(`/assistant/${convId}`);
    await page.locator(".action-card [data-cy='customer-link']").first()
      .waitFor({ state: "visible", timeout: 20_000 });
    expect.eq(
      await page.locator(".action-card [data-cy='customer-link-open']")
        .first().getAttribute("href"),
      `/q/${quote.id}`,
      "the card's Open as customer links to /q/<id>",
    );

    await page.goto(`/q/${quote.id}`);
    await page.locator("[data-cy='quote-internal-preview']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='quote-not-ready']").count(),
      0,
      "a sent quote with its terms is ready to sign",
    );

    const signed = await customerSigns(http, quote.id);
    expect.eq(signed.status, 200, `the customer signs (${signed.body.reason})`);
    const invoices = (await (await http("/api/invoices", { headers: auth }))
      .json() as { quoteId?: string; amount?: number }[])
      .filter((i) => i.quoteId === quote.id);
    expect.eq(
      invoices.map((i) => i.amount).sort((a, b) => (a ?? 0) - (b ?? 0))
        .join(" + "),
      `${TOTAL / 2} + ${TOTAL / 2}`,
      "50/50 bills a deposit and a balance — never one $14,500 invoice",
    );
  }));

Deno.test("REQ-460 (demo-loop cycle 3, B1): after the customer signed, picking 'Deposit + balance' changes nothing on the agreement — the chat says to use a change order or a new version, and the question does not come back", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quote, convId, answer } = await lockedMidWizard(http, auth);
    await finishAndSend(http, auth, convId, quote.id, answer);
    const signed = await customerSigns(http, quote.id);
    expect.eq(signed.status, 200, "Linda signs the sent agreement");

    type Term = { stepId: string; value: string };
    const termsOf = async () =>
      ((await (await http(`/api/quotes/${quote.id}`, { headers: auth }))
        .json()).terms ?? []) as Term[];
    const before = await termsOf();
    const payBefore = before.find((x) => x.stepId === "payment_terms")?.value;
    expect(!!payBefore, `the signed quote carries its payment terms`);

    // the header's Back re-opens the payment question on the signed thread
    await post(http, auth, "/api/agents/wizard/back", {
      conversationId: convId,
      toStepIdx: 3,
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${convId}`);
    const deposit = ".wiz__opts .wiz-opt:has-text('Deposit + balance')";
    await page.locator(deposit).first().waitFor({ timeout: 20_000 });
    const reply = page.locator(".msg:not(.msg--user) .msg__bubble", {
      hasText: /already signed/i,
    });
    await clickUntil(page, deposit, async () => (await reply.count()) > 0);
    const text = (await reply.first().innerText()).trim();
    expect(
      text.includes(quote.number) && /change order/i.test(text) &&
        /new version/i.test(text),
      `the reply names the quote and the way to change it: "${text}"`,
    );
    expect.eq(
      await page.locator(".wiz__opts").count(),
      0,
      "the wizard is closed — no next question (no warranty step)",
    );

    // the agreement did not move
    const after = await termsOf();
    expect.eq(
      after.find((x) => x.stepId === "payment_terms")?.value,
      payBefore,
      "the signed payment terms stand",
    );
    expect.eq(
      JSON.stringify(after).includes("Deposit + balance"),
      false,
      "no 'Deposit + balance' on the signed quote",
    );
    await page.goto(`/q/${quote.id}`);
    await page.locator("[data-cy='quote-signed-banner']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      (await page.locator("body").innerText()).includes("Deposit + balance"),
      false,
      "the signed page shows the terms Linda signed",
    );

    // a reload of the thread keeps it closed
    await page.goto(`/assistant/${convId}`);
    await reply.first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    expect.eq(
      await page.locator(".wiz__opts").count(),
      0,
      "the payment question does not come back after a reload",
    );
  }));
