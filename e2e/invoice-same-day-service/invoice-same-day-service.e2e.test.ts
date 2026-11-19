/**
 * REQ-1064 (LOOP-007 cycle 2, q2-53) — "Public invoice shows a one-day
 * service date as a range". An invoice whose service window is one day
 * (serviceDateFrom == serviceDateTo) shows "November 19, 2026 → November
 * 19, 2026" under "Service dates" on /i/:id, while the email for the same
 * invoice (GET /api/invoices/:id/send-preview — the renderer the send
 * uses) shows "November 19, 2026". Both customer-facing views must show
 * the same single date.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Same Day Story" }),
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
  return auth;
}

/** the text of the cell/div right after the one labelled `label` */
const valueAfter = (html: string, label: string) =>
  html.match(
    new RegExp(`>${label}</(?:div|td)>\\s*<(?:div|td)[^>]*>([^<]*)<`),
  )?.[1]?.trim();

Deno.test("REQ-1064 q2-53: a one-day service date (from == to) reads as one date on /i, the same as the invoice email", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const call = async (method: string, path: string, body?: unknown) =>
      await (await http(path, {
        method,
        headers: auth,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })).json();
    const customer = await call("POST", "/api/customers", {
      name: "Randall Belknap",
      email: "rb@blackhole.postmarkapp.com",
    });
    const inv = await call("POST", "/api/invoices", {
      customerId: customer.id,
      status: "draft",
      jobName: "Spring cleanup",
      description: "Spring cleanup",
      lineItems: [{
        description: "Spring cleanup",
        quantity: 1,
        unit: "visit",
        price: 25000,
      }],
      amount: 25000,
      serviceDateFrom: "2026-11-19",
      serviceDateTo: "2026-11-19",
    });
    expect(!!inv.id, `invoice created (${JSON.stringify(inv).slice(0, 200)})`);

    const preview = await call(
      "GET",
      `/api/invoices/${inv.id}/send-preview?channel=email&lang=en`,
    ) as { email?: { html?: string } };
    const emailDates = valueAfter(preview.email?.html ?? "", "Service dates");
    expect.eq(
      emailDates,
      "November 19, 2026",
      "the invoice email's Service dates row is the one day",
    );

    await page.goto(`/i/${inv.id}`);
    const box = page.locator("[data-cy='invoice-service-dates']");
    await box.waitFor({ timeout: 15_000 });
    const text = (await box.innerText()).replace(/^\s*Service dates\s*/i, "")
      .trim();
    expect.eq(
      (text.match(/November 19, 2026/g) ?? []).length,
      1,
      `/i shows the one-day service date once (got "${text}")`,
    );
    expect(!text.includes("→"), `/i shows no range arrow (got "${text}")`);
    expect.eq(
      text,
      emailDates,
      "/i's Service dates match the email's for the same invoice",
    );
  }));
