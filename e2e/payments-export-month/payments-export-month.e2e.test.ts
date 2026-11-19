/**
 * REQ-1129 (LOOP-007 cycle 3, q3-57) — AMENDMENT of REQ-019 / REQ-926.
 * Raphael (LOOP-007): "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green".
 *
 * QA: a $400.25 check on INV-002, charged back with a $35 fee, then
 * "Export this month" on /payments → the download was the paid-invoice
 * export (one INV-001 row), and the check was in neither CSV.
 * REQ-019: "Export this month" downloads this month's payments as a CSV.
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
  let r: Response;
  // deno-lint-ignore no-explicit-any
  let body: any;
  // the backend boots after the front-end under load: retry while unreachable
  for (let tries = 0;; tries++) {
    r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    body = await r.json();
    if (body.error !== "backend_unreachable" || tries >= 180) break;
    await new Promise((res) => setTimeout(res, 1_000));
  }
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Export Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

async function json(
  http: StoryTools["http"],
  url: string,
  init: RequestInit,
) {
  const r = await http(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(body)}`);
  return body;
}

Deno.test("REQ-1129 (LOOP-007 q3, q3-57): /payments 'Export this month' links the payments CSV, and the charged-back $400.25 check is in it, marked charged back", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const customer = await json(http, "/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Rosa Diaz" }),
    });
    const mk = (job: string, cents: number) =>
      json(http, "/api/invoices", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          customerId: customer.id,
          jobName: job,
          status: "sent",
          lineItems: [{ description: job, quantity: 1, unit: "job", price: cents }],
          subtotalCents: cents,
          amount: cents,
        }),
      });
    const inv1 = await mk(`Deck rebuild ${digits()}`, 254442);
    const inv2 = await mk(`Fence repair ${digits()}`, 120000);
    const now = new Date().toISOString();
    await json(http, "/api/payments", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        invoiceId: inv1.id,
        amount: 254442,
        method: "zelle",
        receivedAt: now,
      }),
    });
    const check = await json(http, "/api/payments", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        invoiceId: inv2.id,
        amount: 40025,
        method: "check",
        receivedAt: now,
      }),
    });
    await json(http, `/api/payments/${check.id}/chargeback`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ feeCents: 3500, reason: "Check bounced" }),
    });

    await page.goto("/payments");
    const link = page.locator("[data-cy='payments-export']");
    await link.waitFor({ timeout: 20_000 });
    await page.locator("[data-cy='payments-reversed-track']").waitFor({
      timeout: 20_000,
    });
    const href = (await link.getAttribute("href")) ?? "";
    expect(
      href.startsWith("/api/payments/export.csv"),
      `"Export this month" downloads the payments CSV (href ${href})`,
    );

    // what the click downloads, with the page's own session
    const csv = await (await http(href, { headers: { cookie: auth.cookie } }))
      .text();
    const lines = csv.trim().split(/\r?\n/);
    const checkLine = lines.find((l) => l.includes("400.25")) ?? "";
    expect(
      checkLine !== "",
      `the downloaded CSV has the $400.25 check:\n${csv}`,
    );
    expect(
      /charged back/i.test(checkLine),
      `the check row says charged back: ${checkLine}`,
    );
    expect(
      lines.some((l) => l.includes("2544.42")),
      `the Zelle payment is in it too:\n${csv}`,
    );
  }));
