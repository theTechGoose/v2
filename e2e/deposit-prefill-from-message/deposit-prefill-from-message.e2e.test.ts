/**
 * REQ-936 — LOOP-007 cycle 1, issue q1-3: "A typed '30% deposit' becomes a
 * 20% deposit marked 'From your message'". The job's text says "30% deposit
 * up front, rest when done"; on "When do you want to get paid?" the
 * "From your message" row must name "Deposit 30% + balance", and its one tap
 * must store that deposit (30% = $6,975 of $23,250), not the plain
 * "Deposit + balance" that bills the legacy 20% ($4,650).
 *
 * Seeded like REQ-265's quote-prefill story: the quote carries the typed text
 * as its description; the steps before payment are answered over the API.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const TOTAL = 2_325_000;
const TYPED =
  "Kitchen remodel for Dana Reyes, $23,250. 30% deposit up front, rest when done.";


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

/** A priced, locked quote — its description is the typed job — whose terms
 *  wizard waits on the payment step. */
async function atPaymentStep(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await post(http, auth, "/api/customers", {
    name: "Dana Reyes",
    email: `dana.reyes.${digits()}@blackhole.postmarkapp.com`,
  });
  const quote = await post(http, auth, "/api/quotes", {
    customerId: customer.id,
    summary: "Kitchen remodel",
    jobName: "Kitchen remodel",
    description: TYPED,
    lineItems: [{
      description: "Kitchen remodel",
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
  return { quote, convId };
}

Deno.test("REQ-936 (LOOP-007 q1-3): '30% deposit up front' in the message — 'From your message' names Deposit 30% + balance and its one tap stores the 30% ($6,975 of $23,250)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quote, convId } = await atPaymentStep(http, auth);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${convId}`);
    const prefill = page.locator('[data-testid="wiz-prefill"]:visible');
    await prefill.first().waitFor({ state: "visible", timeout: 20_000 });
    // the quote (and so its text) loads after the step renders
    let text = "";
    for (let i = 0; i < 40; i++) {
      text = await prefill.first().innerText();
      if (/deposit/i.test(text)) break;
      await page.waitForTimeout(250);
    }
    expect(
      text.includes("Deposit 30% + balance"),
      `the prefill names the typed 30%: "${text}"`,
    );
    expect(
      !/20%/.test(text),
      `the prefill does not offer the 20% the message never said: "${text}"`,
    );

    type Term = { stepId: string; value: string };
    const payTerm = async () =>
      (((await (await http(`/api/quotes/${quote.id}`, { headers: auth }))
        .json()).terms ?? []) as Term[])
        .find((x) => x.stepId === "payment_terms")?.value;
    await clickUntil(
      page,
      '[data-testid="wiz-prefill"]:visible button',
      async () => (await payTerm()) !== undefined,
    );
    expect.eq(
      await payTerm(),
      "Deposit 30% + balance",
      "'Use this' stores the typed 30% deposit, not the plain 20% one",
    );
    await page.getByText("Payment: Deposit 30% + balance").first().waitFor({
      timeout: 15_000,
    });
  }));
