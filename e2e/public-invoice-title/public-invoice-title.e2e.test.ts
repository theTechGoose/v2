/**
 * REQ-984 (LOOP-007 cycle 1, issue q1-60) — "Public invoice heading is the
 * placeholder 'Project'", and its header said "INV-001 · Version 1 · Sent"
 * under an AWAITING CONFIRMATION badge (QA3, QA5).
 *
 *  1. An amount-only invoice (one service line, no job name — what the New
 *     invoice form makes) opened by the customer on /i/:id is headed by the
 *     document, never "Project".
 *  2. The customer reports a Zelle payment on that page: WITHOUT a reload the
 *     headline (data-cy=invoice-headline) agrees with the flipped badge —
 *     "Payment reported", not the server-rendered "Sent" — and after a reload
 *     it still does.
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
    body: JSON.stringify({ language: "en", name: "Title Story" }),
  });
  await me.body?.cancel();
  const identity = await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Title Co",
      acceptedPaymentMethods: { zelle: { enabled: true, handle: "z@x.com" } },
    }),
  });
  await identity.body?.cancel();
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

async function post(
  http: StoryTools["http"],
  headers: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

/** an amount-only invoice as the New invoice form issues it: no job name */
async function amountOnlyInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await post(http, auth, "/api/customers", {
    name: "Ann Lee",
    email: "ann.lee@blackhole.postmarkapp.com",
  });
  return await post(http, auth, "/api/invoices", {
    customerId: customer.id,
    status: "sent",
    amount: 32000,
    lineItems: [{
      description: "Gutter cleaning",
      quantity: 1,
      unit: "job",
      price: 32000,
    }],
  });
}

Deno.test("REQ-984 (q1-60): the customer's /i/:id for an amount-only invoice is not headed 'Project'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await amountOnlyInvoice(http, auth);

    await page.context().clearCookies();
    await page.context().addCookies([{
      name: "pm_lang",
      value: "en",
      domain: new URL(baseUrl).hostname,
      path: "/",
    }]);
    await page.goto(`/i/${inv.id}`);
    const h1 = page.locator("[data-cy='invoice-doc'] h1").first();
    await h1.waitFor({ timeout: 15_000 });
    const title = (await h1.innerText()).trim();
    expect(
      !/^project$/i.test(title),
      `the heading is the placeholder: "${title}"`,
    );
    expect(
      title === "Gutter cleaning" || title.includes(String(inv.number)),
      `the heading names the document (its line or ${inv.number}): "${title}"`,
    );
  }));

Deno.test("REQ-984 (q1-60): after 'Already paid? Tell us how' the headline says 'Payment reported' under the AWAITING CONFIRMATION badge — without a reload, and after one", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await amountOnlyInvoice(http, auth);

    // The customer handed the owner's device (REQ-479 in-person override).
    await page.goto(`/i/${inv.id}?as=customer&confirm=1`);
    const pill = page.locator("[data-status-pill]");
    const headline = page.locator("[data-cy='invoice-headline']");
    await pill.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='claim-method-zelle']").click();
    await page.locator("[data-cy='claim-reference']").fill("ZL-984");
    await page.locator("[data-cy='claim-submit']").click();
    await page.locator("[data-cy='claim-thanks']").waitFor({ timeout: 15_000 });

    // One read of both, so they come from the same render.
    const before = await page.evaluate(() => ({
      pill: document.querySelector("[data-status-pill]")?.textContent ?? "",
      headline:
        document.querySelector("[data-cy='invoice-headline']")?.textContent ??
          "",
    }));
    expect(
      /awaiting confirmation/i.test(before.pill),
      `the badge reads awaiting confirmation (${before.pill})`,
    );
    expect(
      /payment reported/i.test(before.headline) &&
        !/·\s*sent\b/i.test(before.headline),
      `without a reload the headline agrees with the badge — "Payment reported", not "Sent": "${before.headline}" under "${before.pill}"`,
    );

    await page.reload();
    await headline.waitFor({ timeout: 15_000 });
    const after = await page.evaluate(() => ({
      pill: document.querySelector("[data-status-pill]")?.textContent ?? "",
      headline:
        document.querySelector("[data-cy='invoice-headline']")?.textContent ??
          "",
    }));
    expect(
      /awaiting confirmation/i.test(after.pill),
      `after a reload the badge reads awaiting confirmation (${after.pill})`,
    );
    expect(
      /payment reported/i.test(after.headline),
      `after a reload the headline reads "Payment reported": "${after.headline}"`,
    );
  }));
