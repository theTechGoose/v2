/**
 * REQ-691 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue p15: in the owner's preview
 * of their own quote, "Hacer una pregunta" kept its active teal text while its
 * disabled twin "Rechazar" was grey; and the invoice card offered "Enviar SMS
 * al cliente" for a customer with no phone. Ask now looks as off as Decline,
 * and a phoneless customer's card shows "Add a phone" (to their card) instead
 * of "Text client"; a customer with a real phone still gets "Text client".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
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
    body: JSON.stringify({ language: lang, name: "Text Client Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
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

const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

Deno.test("REQ-691 (demo p15, cycle 5): preview Ask is as muted as Decline; Text client only for a customer with a textable phone", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "es");
    const jorge = await post(http, auth, "/api/customers", {
      name: "Jorge Sinfono",
      email: "jorge@blackhole.postmarkapp.com",
    });
    const ana = await post(http, auth, "/api/customers", {
      name: "Ana Contelefono",
      phoneNumber: "+15128675309",
    });

    // (1) the owner's preview of a sent quote
    const quote = await post(http, auth, "/api/quotes", {
      customerId: jorge.id,
      summary: "Reparación de terraza",
      jobName: "Reparación de terraza",
      lineItems: [{
        description: "Reparación de terraza",
        quantity: 1,
        unit: "job",
        price: 250000,
      }],
      estimatedTotal: 250000,
      terms: [{ stepId: "payment_terms", value: "Due Now" }],
      status: "draft",
    });
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    });
    await sent.body?.cancel();
    await page.goto(`/q/${quote.id}`);
    const ask = page.locator("[data-cy='quote-ask']");
    await ask.waitFor({ timeout: 15_000 });
    const colors = await page.evaluate(() => {
      const c = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        const cs = getComputedStyle(el);
        return { color: cs.color, border: cs.borderTopColor };
      };
      return {
        ask: c("[data-cy='quote-ask']"),
        decline: c("[data-cy='quote-decline']"),
      };
    });
    expect.eq(
      JSON.stringify(colors.ask),
      JSON.stringify(colors.decline),
      `Ask wears Decline's muted text and border (${JSON.stringify(colors)})`,
    );
    expect.eq(await ask.isDisabled(), true, "Ask is disabled in preview");

    // (2) the invoice card back face
    for (const [c, job] of [[jorge, "Sin telefono"], [ana, "Con telefono"]]) {
      await post(http, auth, "/api/invoices", {
        customerId: c.id,
        lineItems: [{
          description: "Lawn",
          quantity: 1,
          unit: "visit",
          price: 6500,
        }],
        amount: 6500,
        status: "scheduled",
        scheduledFor: iso(20),
        dueDate: iso(34),
        jobName: job,
      });
    }
    await page.goto("/invoices");
    const card = (job: string) =>
      page.locator("article.qcard", { hasText: job }).first();
    await card("Sin telefono").waitFor({ timeout: 15_000 });
    const backText = async (job: string) =>
      (await card(job).locator(".qcard__back-foot").innerText()).trim();

    const noPhone = await backText("Sin telefono");
    expect.eq(
      noPhone.includes("Enviar SMS al cliente"),
      false,
      `no "Text client" for a phoneless customer: ${noPhone}`,
    );
    const add = card("Sin telefono").locator("[data-cy='invoice-add-phone']");
    expect.eq(await add.count(), 1, "an Add a phone link instead");
    expect.eq(
      await add.getAttribute("href"),
      `/customers?open=${encodeURIComponent(jorge.id)}`,
      "it opens Jorge's customer card",
    );

    const withPhone = await backText("Con telefono");
    expect.eq(
      withPhone.includes("Enviar SMS al cliente"),
      true,
      `"Text client" stays for a textable phone: ${withPhone}`,
    );
  }));
