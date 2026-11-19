/**
 * REQ-1052 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test,
 * then one to fix it and make it green." LOOP-007 cycle 2, issue q2-40:
 * "Invoice detail panel shows 'View as customer' twice" — once in the
 * dispatch row (InvoiceStageActions, invoice-detail-open) and again at the end
 * of the Edit / Discount / … row (invoice-detail-view-as-customer), just
 * before CHANGE ORDERS.
 *
 * In a browser: open /invoices?open=<id> for a sent invoice and a scheduled
 * one; the panel carries exactly one "View as customer" link (to /i/<id>).
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
    body: JSON.stringify({ language: "en", name: "View Once Story" }),
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
  url: string,
  body: unknown,
) {
  const r = await http(url, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function viewLinks(page: StoryTools["page"]) {
  return await page.evaluate(() => {
    const panel = document.querySelector("[data-cy='invoice-detail']");
    if (!panel) return null;
    return [...panel.querySelectorAll("a,button")]
      .filter((el) => (el.textContent ?? "").trim() === "View as customer")
      .map((el) => el.getAttribute("data-cy") ?? "?");
  });
}

for (const status of ["out", "scheduled"] as const) {
  Deno.test(`REQ-1052 (LOOP-007 q2-40): a ${status} invoice's detail panel shows 'View as customer' exactly once`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const { auth } = await signIn(http, page, baseUrl);
      const customer = await post(http, auth, "/api/customers", {
        name: "Marisol Ortega",
        email: "mo@blackhole.postmarkapp.com",
      });
      const job = `Fence repair ${digits()}`;
      const inv = await post(http, auth, "/api/invoices", {
        customerId: customer.id,
        jobName: job,
        lineItems: [{
          description: job,
          quantity: 1,
          unit: "job",
          price: 42000,
        }],
        amount: 42000,
        status,
        ...(status === "scheduled" ? { scheduledFor: inDays(7) } : {}),
        dueDate: inDays(30),
        netDays: 30,
      });

      await page.goto(`/invoices?open=${inv.id}`);
      const panel = page.locator("[data-cy='invoice-detail']");
      await panel.locator("[data-cy='invoice-detail-copy-link']").waitFor({
        timeout: 15_000,
      });
      const links = await viewLinks(page);
      expect(links !== null, "the detail panel is open");
      expect.eq(
        links?.length ?? 0,
        1,
        `one 'View as customer' in the panel (got ${JSON.stringify(links)})`,
      );
    }));
}
