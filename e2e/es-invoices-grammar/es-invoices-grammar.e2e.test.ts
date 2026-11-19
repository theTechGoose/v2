/**
 * REQ-986 — LOOP-007 cycle 1, issue q1-66, in a browser: on /invoices?lang=es
 * one overdue invoice reads "1 está vencida —" (not "vencidas"), the paid
 * card's badge reads "PAGADA" (not "PAGADO"), and the Cancelled track's empty
 * hint says "tus registros" (not usted "sus registros").
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

Deno.test("REQ-986 (LOOP-007 q1-66): /invoices?lang=es — one overdue reads '1 está vencida —', the paid badge reads 'PAGADA', the Cancelled hint says 'tus registros'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signInEs(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Hans Hansen",
      email: "hans.q166@blackhole.postmarkapp.com",
      preferredLanguage: "es",
    });
    const overdueJob = `Cerca ${digits()}`;
    await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: overdueJob,
      amount: 30000,
      lineItems: [{
        description: overdueJob,
        quantity: 1,
        unit: "job",
        price: 30000,
      }],
      status: "sent",
      issuedDate: day(-40),
      dueDate: day(-10),
    });
    const paidJob = `Terraza ${digits()}`;
    const paid = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: paidJob,
      amount: 40000,
      lineItems: [{
        description: paidJob,
        quantity: 1,
        unit: "job",
        price: 40000,
      }],
      status: "sent",
      issuedDate: day(-5),
      dueDate: day(20),
    });
    await post(http, auth, "/api/payments", {
      invoiceId: paid.id,
      amount: 40000,
      method: "zelle",
      receivedAt: new Date().toISOString(),
    });

    await page.goto("/invoices?lang=es");
    // the hero's past-due line (the page carries more than one qph__sub)
    const sub = page.locator("p.qph__sub", { hasText: "vencid" }).first();
    await sub.waitFor({ timeout: 15_000 });
    const subText = ((await sub.textContent()) ?? "").replace(/\s+/g, " ")
      .trim();
    expect.eq(
      subText.match(/1 \S+ \S+ —/)?.[0] ?? subText,
      "1 está vencida —",
      "the hero line agrees with one invoice",
    );

    const paidCard = page.locator("article.qcard", { hasText: paidJob });
    await paidCard.waitFor({ timeout: 15_000 });
    const badge = paidCard.locator(".qcard__status").first();
    const badgeText = await badge.evaluate((el) =>
      (el as HTMLElement).innerText.replace(/\s+/g, " ").trim()
    );
    expect.eq(badgeText, "PAGADA", "the paid card's badge is feminine");

    const cancelled = page.locator("section.qtrack", { hasText: "Canceladas" });
    await cancelled.locator(".qtrack__head").click();
    const hint =
      ((await cancelled.locator(".qtrack__body").textContent()) ?? "")
        .replace(/\s+/g, " ").trim();
    expect.eq(
      hint.match(/\S+ registros/)?.[0] ?? hint,
      "tus registros",
      "the Cancelled hint speaks tú",
    );
  }));
