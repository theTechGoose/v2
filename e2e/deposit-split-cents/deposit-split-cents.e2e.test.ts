/**
 * REQ-1091 — LOOP-007 cycle 3, issue q3-7 [minor/BUG_CONTRADICTION]: "Chat
 * payment step rounds deposit/balance to whole dollars while the preview and
 * agreement show cents". On a $4,250.50 quote the "When do you want to get
 * paid?" step's Deposit + balance sub-line and the "How big a deposit?" chips
 * must name the exact split computePaymentSplit bills (REQ-961: cents unless
 * the amount is whole) — not "$850 / $3,400" and "$2,125 now · $2,125 when
 * done" (halves that do not add up to the total).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const TOTAL = 425_050; // $4,250.50 — not a whole dollar

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

Deno.test("REQ-1091 (LOOP-007 q3, q3-7): on a $4,250.50 quote the payment step reads $850.10 / $3,400.40 and the 50% chip names $2,125.25 + $2,125.25, not $2,125 + $2,125", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { convId } = await lockedMidWizard(http, auth);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${convId}`);
    const deposit = ".wiz__opts .wiz-opt:has-text('Deposit + balance')";
    await page.locator(deposit).first().waitFor({ timeout: 20_000 });

    // read the three surfaces first, then judge them together, so one red
    // run shows every rounded figure
    const sub = await page.locator(deposit).first().innerText();
    const picker = page.locator("[data-testid='deposit-pick']");
    await clickUntil(page, deposit, async () => (await picker.count()) > 0);
    const half = await page.locator("[data-testid='deposit-pick-50']")
      .innerText();
    const fifth = await page.locator("[data-testid='deposit-pick-20']")
      .innerText();

    // the chip copy around the figures may change (REQ-1082 / q3-8); the
    // figures, in order, are what this pins
    const misses = [
      sub.includes("$850.10 / $3,400.40")
        ? ""
        : `the Deposit + balance sub-line names the exact 20% split $850.10 / $3,400.40: "${sub}"`,
      /\$2,125\.25\b[^$]*\$2,125\.25\b/.test(half)
        ? ""
        : `the 50% chip's halves add up to $4,250.50 ($2,125.25 + $2,125.25): "${half}"`,
      /\$850\.10\b[^$]*\$3,400\.40\b/.test(fifth)
        ? ""
        : `the 20% chip names the same split as the sub-line ($850.10 / $3,400.40): "${fifth}"`,
    ].filter(Boolean);
    expect(misses.length === 0, misses.join(" | ").replace(/\n/g, " "));
  }));
