/**
 * REQ-966 (LOOP-007 q1, q1-41) — the invoice PDF says what the customer's
 * /i page says. An overdue, partly-paid, amount-only invoice (INV-002 in the
 * run): /i shows the pill "Past due" and the heading "Project"; its PDF
 * printed "PENDING" and the quote PDF's "Service Agreement".
 */
import { story, type StoryTools } from "#shots";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "npm:pdf-lib@^1.17.1";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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
    body: JSON.stringify({ language: "en", name: "PDF Story" }),
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

/** Every content stream of the PDF, latin1, upper-cased (hex text included). */
async function drawnUpper(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let drawn = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        drawn += new TextDecoder("latin1").decode(
          decodePDFRawStream(obj).decode(),
        );
      } catch { /* not a text stream */ }
    }
  }
  return drawn.toUpperCase();
}
const hexOf = (s: string) =>
  [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    .toUpperCase();

Deno.test("REQ-966 q1-41: an overdue, partly-paid, amount-only invoice's PDF carries the /i pill and heading — not 'PENDING', not 'Service Agreement'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Pat Overdue",
        email: "pat@blackhole.postmarkapp.com",
      }),
    })).json();
    const created = await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        amount: 120000,
        issuedDate: day(-40),
        dueDate: day(-10),
      }),
    });
    const inv = await created.json();
    expect(created.ok, `invoice created (${created.status})`);
    const pay = await http("/api/payments", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        invoiceId: inv.id,
        amount: 40000,
        method: "check",
        receivedAt: new Date().toISOString(),
      }),
    });
    await pay.body?.cancel();
    expect(pay.ok, `part payment recorded (${pay.status})`);

    await page.goto(`/i/${inv.id}`);
    const pill = page.locator("[data-status-pill]").first();
    await pill.waitFor({ timeout: 15_000 });
    const pillText = (await pill.innerText()).trim();
    const heading = (await page.locator("[data-cy='invoice-doc'] h1").first()
      .innerText()).trim();
    expect.eq(pillText.toUpperCase(), "PAST DUE", "setup: /i says Past due");
    // REQ-984 (q1-60): an amount-only invoice is headed by its number,
    // never "Project"
    expect.eq(heading, "Invoice INV-001", "setup: /i is headed 'Invoice INV-001'");

    const r = await http(`/api/invoices/${inv.id}/pdf`, { headers: auth });
    expect.eq(r.status, 200, "the PDF downloads");
    if (r.status !== 200) return;
    const up = await drawnUpper(new Uint8Array(await r.arrayBuffer()));
    expect(
      !up.includes(hexOf("PENDING")),
      "the PDF does not print the stored status 'PENDING'",
    );
    expect(
      up.includes(hexOf(pillText.toUpperCase())) || up.includes(hexOf(pillText)),
      `the PDF prints the /i pill '${pillText}'`,
    );
    expect(
      !up.includes(hexOf("Service Agreement")),
      "the PDF is not titled 'Service Agreement'",
    );
    expect(
      up.includes(hexOf(heading)),
      `the PDF is titled like /i: '${heading}'`,
    );
  }));
