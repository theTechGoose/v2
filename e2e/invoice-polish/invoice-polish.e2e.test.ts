/**
 * The invoice polish of 2026-11-05 (REQ-161 …), on the real shell: the PDF
 * download, the per-invoice delete, the business website, the closing copy.
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
    body: JSON.stringify({ language: "en", name: "Invoice Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

async function mkInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Randall Belknap",
      email: "rb@blackhole.postmarkapp.com",
    }),
  })).json();
  const inv = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      status: "draft",
      jobName: "Maintenance 2026-10-01 → 2026-10-31",
      description: "Oct 2 — Lawn — 725 Frederick Rd, Rockingham, VA",
      lineItems: [{
        description: "Oct 2 — Lawn — 725 Frederick Rd, Rockingham, VA",
        quantity: 1,
        unit: "visit",
        price: 6500,
      }],
      amount: 6500,
      ...extra,
    }),
  })).json();
  return { customer, inv };
}

Deno.test("REQ-161: an invoice titled 'Maintenance 2026-10-01 → 2026-10-31' downloads as a PDF (200, application/pdf) instead of a 500", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { inv } = await mkInvoice(http, auth);
    const r = await http(`/api/invoices/${inv.id}/pdf`, { headers: auth });
    const detail = r.status === 200 ? "" : (await r.text()).slice(0, 120);
    expect.eq(r.status, 200, `Download PDF answers 200 (${detail})`);
    if (r.status !== 200) return;
    expect(
      (r.headers.get("content-type") ?? "").includes("application/pdf"),
      `content-type is application/pdf (${r.headers.get("content-type")})`,
    );
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect.eq(
      new TextDecoder().decode(bytes.slice(0, 5)),
      "%PDF-",
      "the body is a PDF",
    );
  }));
