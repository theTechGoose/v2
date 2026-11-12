/**
 * REQ-480 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3 (run re05e1cbb), issue M18: after "Issue invoice"
 * for a client with no email and a phone the text could not reach, /invoices
 * showed a red QUOTE notice ("Cotización + Acuerdo redactada — no hay
 * correo…") while the list said "INV-002 · Enviada".
 *
 * Now the notice is the invoice's own sentence — "INV-00N not delivered — no
 * email on file; the text failed: <reason>" — and the invoice is not listed
 * as sent: it stays a draft until a channel delivers it (the send endpoints
 * stamp "sent" on delivery).
 *
 * Page: /invoices?new=1 (front-end/islands/InvoicesPage.tsx NewInvoiceModal
 * → POST /api/invoices, then POST /api/invoices/:id/{email,text}).
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
    body: JSON.stringify({ language: "en", name: "Send Fail Story" }),
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

Deno.test("REQ-480 M18: 'Issue invoice' for a client with no email and a fictional 555 phone → the invoice's own 'not delivered' notice (no Quote + Agreement wording, the text's reason kept) and the invoice is not listed as sent", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Ana Ruiz", phoneNumber: "+15125550188" }),
    })).json();

    await page.goto("/invoices?new=1");
    const modal = page.locator("[data-cy='new-invoice-modal']");
    await modal.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='new-invoice-client']").selectOption(
      customer.id,
    );
    await page.locator("[data-cy='new-invoice-amount']").fill("1200");
    await page.locator("[data-cy='new-invoice-submit']").click();

    const notice = page.locator("[data-cy='invoice-send-failure']");
    await notice.waitFor({ timeout: 20_000 });
    const text = await notice.innerText();
    expect(
      /INV-\d+ not delivered — no email on file; the text failed: /.test(text),
      `the invoice's own not-delivered sentence (${text})`,
    );
    expect(/555/.test(text), `the text's reason is kept (${text})`);
    expect(
      !/quote|agreement/i.test(text),
      `no Quote + Agreement wording (${text})`,
    );

    const all = await (await http("/api/invoices", { headers: auth }))
      .json() as Array<{ customerId?: string; status?: string }>;
    const mine = all.filter((i) => i.customerId === customer.id);
    expect.eq(mine.length, 1, "one invoice was created");
    expect.eq(mine[0].status, "draft", "nothing delivered → not sent");
  }));
