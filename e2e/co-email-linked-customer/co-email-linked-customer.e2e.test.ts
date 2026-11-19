/**
 * REQ-1021 (LOOP-007 cycle 2, q2-13; REQ-565/REQ-204) — a quote drafted before
 * its customer was on file and linked to her afterwards (PUT customerId, the
 * path BindConversationCustomer and send-quote take) still sends its change
 * orders to her: the CO row's Email is `mailto:<her address>?…`, not a bare
 * `mailto:?subject=…`.
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
    body: JSON.stringify({ language: "en", name: "CO Email Linked Customer" }),
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
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers,
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

Deno.test("REQ-1021 (LOOP-007 q2-13): a quote linked to its customer after create — the change order row's Email goes to her address, not a bare mailto:", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    // the assistant drafts the quote before the brand-new customer is on file
    const quote = await call(http, auth, "POST", "/api/quotes", {
      summary: "Bathroom Remodel",
      jobName: "Bathroom Remodel",
      lineItems: [{
        description: "Bathroom remodel",
        quantity: 1,
        unit: "job",
        price: 705000,
      }],
      estimatedTotal: 705000,
      status: "draft",
    });
    const maria = await call(http, auth, "POST", "/api/customers", {
      name: "Maria Garcia",
      email: "maria.g@example.com",
    });
    // linked later, as BindConversationCustomer / send-quote do
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      customerId: maria.id,
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });
    await call(http, JSON_HEADERS, "POST", `/api/quotes/${quote.id}/accept`, {
      name: "Maria Garcia",
      version: 1,
    });
    const ledger = await call(
      http,
      auth,
      "GET",
      `/api/quotes/${quote.id}/ledger`,
    );
    const invoice = ledger.invoices[0];
    if (!invoice) throw new Error("signing billed no invoice");
    const co = await call(
      http,
      auth,
      "POST",
      `/api/invoices/${invoice.id}/change-orders`,
      { description: "Frameless glass door", deltaAmountCents: 120000 },
    );

    await page.goto(`/quotes?open=${quote.id}`);
    const row = page.locator("[data-cy='ledger-co-row']", {
      hasText: co.number,
    });
    await row.waitFor({ timeout: 15_000 });
    const mail = await row.locator("[data-cy='ledger-co-email']")
      .getAttribute("href");
    expect(
      (mail ?? "").startsWith("mailto:maria.g@example.com?"),
      `Email goes to Maria (${mail})`,
    );
    expect(
      decodeURIComponent(mail ?? "").includes(`/co/${co.id}`),
      `the email carries /co/${co.id}`,
    );
  }));
