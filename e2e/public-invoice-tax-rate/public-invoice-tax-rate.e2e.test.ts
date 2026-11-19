/**
 * REQ-1142 — LOOP-007 cycle 3, issue q3-72 [polish/BUG_POLISH], in a browser
 * on the real shell: "Tax rate reads '7.00%' on /i but '7%' elsewhere".
 *
 * QA: an invoice with 7% tax, emailed in Spanish. The outbox email reads
 * "Impuesto (7%)", the owner's send sheet "Tax (7%)", and the customer's
 * public page /i "Impuesto (7.00%)". The /i tax label must print the rate
 * the way the email does.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"]) {
  const phone = `+1512${digits()}`;
  // the dev backend can still be booting when the frontend answers: wait it out
  let r = new Response();
  let body: Record<string, unknown> = {};
  for (let i = 0; i < 120; i++) {
    r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    body = await r.json();
    if (body.error !== "backend_unreachable") break;
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
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return await r.json();
}

type Row = { id: string; kind: string; channel: string };

Deno.test("REQ-1142 (LOOP-007 q3, q3-72): an invoice with 7% tax — the customer's /i reads 'Impuesto (7%)' exactly like the outbox email, never 'Impuesto (7.00%)'", (t) =>
  story(t, async ({ page, expect, http }) => {
    const { auth } = await signIn(http);
    const customer = await post(http, auth, "/api/customers", {
      name: "Rosa Delgado",
      email: "rosa.delgado@blackhole.postmarkapp.com",
    });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      status: "sent",
      lineItems: [{
        description: "Reparación de techo",
        quantity: 1,
        unit: "job",
        price: 1000_00,
      }],
      subtotalCents: 1000_00,
      taxRateBp: 700,
      taxCents: 70_00,
      amount: 1070_00,
    });
    expect.eq(inv.taxRateBp, 700, "the 7% rate is stored as 700 bp");

    const sent = await post(http, auth, `/api/invoices/${inv.id}/email`, {
      language: "es",
    });
    expect(
      sent.ok !== false,
      `the invoice email went (${JSON.stringify(sent)})`,
    );
    const rows = (await (await http("/api/outbox", { headers: auth }))
      .json()) as Row[];
    const mail = rows.find((r) =>
      r.kind === "invoice" && r.channel === "email"
    );
    expect(
      !!mail,
      `the invoice email is in the Outbox (${JSON.stringify(rows)})`,
    );
    const { body } = await (await http(`/api/outbox/${mail!.id}`, {
      headers: auth,
    })).json() as { body: string };
    const emailLabel = body.match(/Impuesto \([^)]*\)/)?.[0] ?? "";
    expect.eq(emailLabel, "Impuesto (7%)", "the Spanish email's tax label");

    // the customer opens the link: no owner session, Spanish
    await page.context().clearCookies();
    await page.goto(`/i/${inv.id}?lang=es`);
    await page.locator("[data-cy='invoice-doc']").waitFor({ timeout: 15_000 });
    const pageLabel = await page.evaluate(() =>
      [...document.querySelectorAll("[data-cy='invoice-doc'] span")]
        .map((s) => (s.textContent ?? "").trim())
        .find((t) => t.startsWith("Impuesto (")) ?? ""
    );
    expect.eq(
      pageLabel,
      emailLabel,
      `the /i tax label matches the email's (got "${pageLabel}")`,
    );
  }));
