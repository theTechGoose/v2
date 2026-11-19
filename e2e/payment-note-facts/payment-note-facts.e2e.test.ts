/**
 * REQ-960 (LOOP-007 cycle 1, q1-36) — QA recorded a Check, $400, ref 1042 by hand and the
 * /payments card read "Check from Luis, deposited via mobile." (es: "Cheque de Luis, depositado
 * por la app."): a deposit channel nobody entered, and the ref they did type missing.
 *
 * Page: /payments (front-end/islands/PaymentsPage.tsx PaymentCard, .qcard__story / .qcard__read).
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
    body: JSON.stringify({ language: lang, name: "Payment Note Story" }),
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

async function makeInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customer: Record<string, string>,
  status: "draft" | "sent",
) {
  const today = new Date().toISOString().slice(0, 10);
  return await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: (await (await http("/api/customers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify(customer),
      })).json()).id,
      jobName: "Fence repair",
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "job",
        price: 40000,
      }],
      amount: 40000,
      status,
      issuedDate: today,
      dueDate: today,
    }),
  })).json() as { id: string };
}


for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-960 q1-36 (${lang}): a hand-recorded check's /payments card shows its ref 1042 and no invented deposit channel`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const { auth } = await signIn(http, page, baseUrl, lang);
      const inv = await makeInvoice(http, auth, {
        name: "Luis Ortega",
        phoneNumber: `+1512${digits()}`,
      }, "sent");
      const paid = await http("/api/payments", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          invoiceId: inv.id,
          amount: 40000,
          method: "check",
          reference: "1042",
          receivedAt: new Date().toISOString(),
        }),
      });
      expect(paid.ok, `the payment is recorded (${paid.status})`);
      const row = await paid.json() as { reference?: string };
      expect.eq(row.reference, "1042", "the server stored the typed ref");

      await page.goto("/payments");
      const card = page.locator("[data-cy='payment-card']").first();
      await card.waitFor({ timeout: 15_000 });
      const [front, back] = await card.evaluate((el) => [
        el.querySelector(".qcard__story")?.textContent ?? "",
        el.querySelector(".qcard__read")?.textContent ?? "",
      ]);
      for (const [face, text] of [["front", front], ["back", back]]) {
        expect(text.includes("Luis"), `${face} names the payer: "${text}"`);
        expect(text.includes("1042"), `${face} shows the ref 1042: "${text}"`);
        expect(
          !/mobile|móvil|deposited via|por la app/i.test(text),
          `${face} invents no deposit channel: "${text}"`,
        );
      }
    }));
}

/**
 * REQ-1122 (LOOP-007 cycle 3, q3-50; amends REQ-960) — QA recorded a Check with reference
 * "Check #1042" (the Mark-paid placeholder reads "e.g. check #1042") and the /payments card
 * read "Check Check #1042 from Greg." (es: "Cheque Check #1042 de Greg."). The method word
 * must appear once.
 */
for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1122 q3-50 (${lang}): a check recorded with ref "Check #1042" reads once-worded on the /payments card`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const { auth } = await signIn(http, page, baseUrl, lang);
      const inv = await makeInvoice(http, auth, {
        name: "Greg Pruitt",
        phoneNumber: `+1512${digits()}`,
      }, "sent");
      const paid = await http("/api/payments", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          invoiceId: inv.id,
          amount: 40000,
          method: "check",
          reference: "Check #1042",
          receivedAt: new Date().toISOString(),
        }),
      });
      expect(paid.ok, `the payment is recorded (${paid.status})`);
      const row = await paid.json() as { reference?: string };
      expect.eq(row.reference, "Check #1042", "the server stored the typed ref");

      await page.goto("/payments");
      const card = page.locator("[data-cy='payment-card']").first();
      await card.waitFor({ timeout: 15_000 });
      const front = await card.evaluate((el) =>
        (el.querySelector(".qcard__story")?.textContent ?? "").trim()
      );
      expect(
        !/\b(check|cheque)\s+(check|cheque)\b/i.test(front),
        `the card front does not double the method: "${front}"`,
      );
      expect.eq(
        front,
        lang === "en" ? "Check #1042 from Greg." : "Cheque #1042 de Greg.",
        "the card front states the method once, then the ref and payer",
      );
    }));
}
