/**
 * REQ-1106 (LOOP-007 cycle 3, q3-32) — a signed quote with a change order
 * SENT to the customer and nothing else out: /quotes read
 *   "CO-001 is waiting on Maria Lopez."
 *   "Every quote you have sent is decided. Start the next one when you are ready."
 * The headline says something is waiting; the line under it says nothing is.
 * The hero must not put the settled subline under a waiting change order.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

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
    body: JSON.stringify({ language: "en", name: "CO Unsent Pipeline Story" }),
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

async function call(
  http: StoryTools["http"],
  auth: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers: auth,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

const line = (description: string, price: number) => ({
  description,
  quantity: 1,
  unit: "ea",
  price,
});

Deno.test("REQ-1106 (LOOP-007 q3-32): with a sent change order waiting and no quote out, the /quotes hero does not say every quote is decided under it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, {
      name: "CO Waiting Settled Story",
      businessName: "CO Waiting Settled LLC",
    });
    const maria = await call(http, auth, "POST", "/api/customers", {
      name: "Maria Lopez",
      email: "maria@blackhole.postmarkapp.com",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: maria.id,
      summary: "Kitchen remodel — Maria Lopez",
      jobName: "Kitchen remodel",
      lineItems: [line("Cabinets", 1200000)],
      estimatedTotal: 1200000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    await call(http, JSON_HEADERS, "POST", `/api/quotes/${quote.id}/accept`, {
      name: "Maria Lopez",
      version: 1,
    });
    // signing bills the first invoice — the change order goes on it and is
    // sent to Maria (pending her approval)
    const ledger = await call(
      http,
      auth,
      "GET",
      `/api/quotes/${quote.id}/ledger`,
    );
    const invoice = ledger.invoices[ledger.invoices.length - 1];
    if (!invoice) throw new Error("signing billed no invoice");
    if (invoice.status === "draft") {
      await call(http, auth, "PUT", `/api/invoices/${invoice.id}`, {
        status: "sent",
      });
    }
    await call(
      http,
      auth,
      "POST",
      `/api/invoices/${invoice.id}/change-orders`,
      {
        description: "Upgraded countertops",
        deltaAmountCents: 280000,
      },
    );
    const listed = await call(
      http,
      auth,
      "GET",
      `/api/invoices/${invoice.id}/change-orders`,
    );
    expect.eq(listed[0]?.status, "pending", "CO-001 waits for Maria");

    await page.goto("/quotes");
    const waiting = page.locator("[data-cy='quotes-hero-co-waiting']");
    await waiting.first().waitFor({ timeout: 30_000 });
    const hero = page.locator(".qph");
    const heroText = (await hero.innerText()).replace(/\s+/g, " ").trim();
    expect(
      heroText.includes("CO-001 is waiting on Maria Lopez."),
      `the hero names the waiting change order (hero: "${heroText}")`,
    );
    expect(
      !heroText.includes("Every quote you have sent is decided"),
      `no "Every quote you have sent is decided" under a waiting change order (hero: "${heroText}")`,
    );
  }));
