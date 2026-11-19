/**
 * REQ-1083 — LOOP-007 cycle 3, issue q3-15, in a browser: on /invoices?lang=es
 * the hero's at-risk line agrees with its count in Spanish word order —
 * one overdue invoice reads "en riesgo en 1 factura vencida", two read
 * "en riesgo en 2 facturas vencidas"; never "1 vencidas factura".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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
  if (r.status >= 300) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

async function signInEs(
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es", name: "Rosa Gramática" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  return auth;
}

async function seedOverdue(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customerId: string,
  label: string,
) {
  const job = `${label} ${digits()}`;
  await post(http, auth, "/api/invoices", {
    customerId,
    jobName: job,
    amount: 22500,
    lineItems: [{ description: job, quantity: 1, unit: "job", price: 22500 }],
    status: "sent",
    issuedDate: day(-40),
    dueDate: day(-10),
  });
}

async function atRiskText(page: StoryTools["page"]) {
  const line = page.locator("[data-cy=forecast-at-risk]").first();
  await line.waitFor({ timeout: 15_000 });
  return ((await line.textContent()) ?? "").replace(/\s+/g, " ").trim();
}

Deno.test("REQ-1083 (LOOP-007 q3-15): /invoices?lang=es — the at-risk line reads 'en riesgo en 1 factura vencida', then 'en riesgo en 2 facturas vencidas'; never 'vencidas factura'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signInEs(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Hans Hansen",
      email: "hans.q315@blackhole.postmarkapp.com",
      // (an undeclared preferredLanguage key was silently ignored here; REQ-1119 now refuses it)
    });

    await seedOverdue(http, auth, customer.id, "Cerca");
    await page.goto("/invoices?lang=es");
    const one = await atRiskText(page);
    expect.eq(
      one.match(/en riesgo en 1 [^\s.]+ [^\s.]+/)?.[0] ?? one,
      "en riesgo en 1 factura vencida",
      "one overdue invoice: noun then singular adjective",
    );
    expect.eq(
      /vencidas factura/.test(one),
      false,
      `no English word order / plural adjective on one invoice — got "${one}"`,
    );

    await seedOverdue(http, auth, customer.id, "Techo");
    await page.goto("/invoices?lang=es");
    const two = await atRiskText(page);
    expect.eq(
      two.match(/en riesgo en 2 [^\s.]+ [^\s.]+/)?.[0] ?? two,
      "en riesgo en 2 facturas vencidas",
      "two overdue invoices: noun then plural adjective",
    );
  }));
