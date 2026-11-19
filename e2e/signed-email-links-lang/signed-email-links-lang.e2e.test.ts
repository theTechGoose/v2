/**
 * REQ-1050 (LOOP-007 cycle 2, issue q2-36; amends REQ-342) — "English signed
 * email links to /i and /q without ?lang, so a Spanish browser shows a
 * Spanish invoice for an English job".
 *
 * QA2 (fleet-r66a3e3fc-1 stdout:40): the English customer email (005)
 * "Pay the first invoice →" linked to /i/<id> with no ?lang; the browser
 * had opened a Spanish quote earlier (/s/…?lang=es → pm_lang=es), so the
 * invoice page read "Factura" / "PENDIENTE". The /q link in the same email
 * lacked ?lang too.
 *
 *  1. An account that sends in English and Spanish; an English customer;
 *     a 50/50 quote, sent — all through the API.
 *  2. The customer signs (POST /api/quotes/:id/accept).
 *  3. The outbox's signed-copy email: take its /i and /q hrefs.
 *  4. A visitor whose browser carries pm_lang=es opens each href: the page
 *     is English (<html lang="en">, "Invoice", not "Factura").
 *
 * Pages: /i/[id] (front-end/routes/i/[id].tsx), /q/[id]; server:
 * send-signed-confirmation (the email's links).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signIn(
  http: StoryTools["http"],
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  for (
    const [path, payload] of [
      ["/api/me", { name: "Owen Park", language: "en" }],
      // the account sends in both languages — QA's had a Spanish Q-002 too
      ["/api/profile/identity", {
        businessName: "Park Decks",
        commsLanguage: "en",
        commsLanguages: ["en", "es"],
      }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
  return auth;
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
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

type OutboxRow = { id: string; kind: string; channel: string };

Deno.test("REQ-1050 q2-36 (REQ-342): an English job's signed email — its 'Pay the first invoice' and 'View the agreement online' links open in English in a browser that carries pm_lang=es", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http);

    // 1 — an English customer, a 50/50 quote, sent
    const linda = await call(http, auth, "POST", "/api/customers", {
      name: "Linda Park",
      email: "linda@blackhole.postmarkapp.com",
      language: "en",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: linda.id,
      summary: "Deck repair",
      jobName: "Deck repair",
      lineItems: [{
        description: "Deck repair",
        quantity: 1,
        unit: "job",
        price: 200000,
      }],
      estimatedTotal: 200000,
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50/50",
      }],
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
    });

    // 2 — she signs
    await call(http, JSON_HEADERS, "POST", `/api/quotes/${quote.id}/accept`, {
      name: "Linda Park",
      version: 1,
    });

    // 3 — the signed-copy email in the outbox, and its links
    let row: OutboxRow | undefined;
    for (let i = 0; i < 50 && !row; i++) {
      const list = await (await http("/api/outbox", { headers: auth }))
        .json() as OutboxRow[];
      row = list.find((r) => r.kind === "signedCopy" && r.channel === "email");
      if (!row) await new Promise((res) => setTimeout(res, 200));
    }
    if (!row) throw new Error("no signed-copy email reached the outbox");
    const msg = await (await http(`/api/outbox/${row.id}`, { headers: auth }))
      .json() as { body?: string };
    const html = msg.body ?? "";
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)]
      .map((m) => new URL(m[1].replaceAll("&amp;", "&"), baseUrl));
    const invoiceLink = hrefs.find((u) => /^\/i\/[^/]+$/.test(u.pathname));
    const agreementLink = hrefs.find((u) => u.pathname === `/q/${quote.id}`);
    if (!invoiceLink) throw new Error("the email has no /i link");
    if (!agreementLink) throw new Error("the email has no /q link");

    // 4 — a visitor whose browser chose Spanish earlier opens them
    await page.context().clearCookies();
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({
        name: "pm_lang",
        value: "es",
        domain,
        path: "/",
      })),
    );

    await page.goto(invoiceLink.pathname + invoiceLink.search);
    await page.waitForLoadState("domcontentloaded");
    const inv = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      factura: /\bFactura\b/.test(document.body.innerText),
      invoice: /\bInvoice\b/.test(document.body.innerText),
    }));
    expect.eq(
      `href=${invoiceLink.pathname}${invoiceLink.search} html=${inv.lang} Invoice=${inv.invoice} Factura=${inv.factura}`,
      `href=${invoiceLink.pathname}?lang=en html=en Invoice=true Factura=false`,
      "'Pay the first invoice →' of an English job opens the invoice in English, whatever the browser chose before",
    );

    await page.goto(agreementLink.pathname + agreementLink.search);
    await page.waitForLoadState("domcontentloaded");
    const agreementLang = await page.evaluate(() =>
      document.documentElement.lang
    );
    expect.eq(
      `href=${agreementLink.pathname}${agreementLink.search} html=${agreementLang}`,
      `href=${agreementLink.pathname}?lang=en html=en`,
      "'View the agreement online' of an English job opens the agreement in English",
    );
  }));
