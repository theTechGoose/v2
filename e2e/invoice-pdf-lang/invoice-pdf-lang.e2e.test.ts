/**
 * REQ-1133 (LOOP-007 cycle 3, q3-65; amends REQ-272 + REQ-586) — "/i
 * 'Download PDF' link carries no lang".
 *
 * QA (fleet-r0c106d7f-2): the /i "Download PDF" href is
 * /api/invoices/<id>/pdf with no lang, and the endpoint ignores the language
 * anyway — the PDF always renders in the contractor's Settings comms
 * language. A customer reading /i in Spanish (the EN | ES toggle, REQ-272)
 * downloads an English PDF.
 *
 *  1. An English-comms owner who sends in both languages; an invoice.
 *  2. /i/<id>?lang=es (the customer picked Español): the page paints Spanish.
 *  3. The "Descargar PDF" href carries lang=es.
 *  4. Following that href downloads a Spanish PDF: title "Factura INV-…".
 */
import { story, type StoryTools } from "#shots";
import { PDFDocument } from "npm:pdf-lib@^1.17.1";

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
    body: JSON.stringify({ language: "en", name: "Luis Ortega" }),
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

Deno.test("REQ-1133 (LOOP-007 q3, q3-65): on /i?lang=es the 'Descargar PDF' link carries lang=es and downloads a Spanish PDF ('Factura INV-…')", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    // REQ-925: the account sends in both languages; its default is English
    const id = await http("/api/profile/identity", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        businessName: "Ortega Handyman Services",
        commsLanguage: "en",
        commsLanguages: ["en", "es"],
      }),
    });
    await id.body?.cancel();
    expect(id.ok, `identity saved (${id.status})`);

    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Carmen Núñez",
        email: "carmen@blackhole.postmarkapp.com",
      }),
    })).json();
    const created = await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Faucet repair",
        amount: 45000,
      }),
    });
    const inv = await created.json();
    expect(created.ok, `invoice created (${created.status})`);

    // 2 — the customer reads /i in Spanish
    await page.goto(`/i/${inv.id}?lang=es`);
    const link = page.locator("a", { hasText: "Descargar PDF" }).first();
    await link.waitFor({ timeout: 15_000 });
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "es",
      "setup: /i paints Spanish",
    );

    // 3 — the link carries the page's language
    const href = (await link.getAttribute("href")) ?? "";
    const url = new URL(href, baseUrl);
    expect.eq(
      url.searchParams.get("lang"),
      "es",
      `the Download PDF href carries lang=es (got ${href})`,
    );

    // 4 — and what it downloads is Spanish
    const r = await http(`${url.pathname}${url.search}`, { headers: auth });
    expect.eq(r.status, 200, "the PDF downloads");
    if (r.status !== 200) return;
    const doc = await PDFDocument.load(new Uint8Array(await r.arrayBuffer()));
    expect.eq(
      doc.getTitle(),
      `Factura ${inv.number}`,
      "the PDF from /i in Spanish is Spanish",
    );
  }));
