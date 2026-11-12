/**
 * REQ-321 — demo-loop cycle 1, issue M14: "Open page doesn't refresh status".
 * In a browser, with NO reload by the test:
 *  - the customer claims on /i/:id, the owner confirms from another session,
 *    and the open tab's badge flips to PAID on its own (the demo's pair 9);
 *  - a tab opened on an already-claimed invoice does the same;
 *  - /quotes moves a quote out of "Out for response" once the customer signs
 *    (the demo's pair 3), on the window's focus.
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
    body: JSON.stringify({ language: "en", name: "Refresh Story" }),
  });
  await me.body?.cancel();
  const identity = await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Refresh Co",
      acceptedPaymentMethods: { zelle: { enabled: true, handle: "z@x.com" } },
    }),
  });
  await identity.body?.cancel();
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

async function sentInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  jobName: string,
) {
  const customer = await post(http, auth, "/api/customers", {
    name: "Juan Pérez",
    email: "juan@blackhole.postmarkapp.com",
  });
  return await post(http, auth, "/api/invoices", {
    customerId: customer.id,
    status: "sent",
    jobName,
    description: jobName,
    lineItems: [{ description: jobName, quantity: 1, price: 48000 }],
    amount: 48000,
    dueDate: "2026-12-05",
  });
}

Deno.test("REQ-321 M14: the customer's open /i/:id tab flips to PAID by itself once the owner confirms the claim", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await sentInvoice(http, auth, "Fence repair REQ-321 a");

    // The customer's tab: claim IN the page (the demo's exact path).
    await page.goto(`/i/${inv.id}`);
    const pill = page.locator("[data-status-pill]");
    await pill.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='claim-method-zelle']").click();
    await page.locator("[data-cy='claim-reference']").fill("ZL-321");
    await page.locator("[data-cy='claim-submit']").click();
    await page.locator("[data-cy='claim-thanks']").waitFor({ timeout: 15_000 });
    expect(
      /awaiting confirmation/i.test(await pill.innerText()),
      `after the claim the badge reads awaiting confirmation (${await pill
        .innerText()})`,
    );

    // The owner confirms from their own session — not this tab.
    await post(http, auth, `/api/invoices/${inv.id}/confirm-payment`, {});

    // The open tab notices on its own (10 s poll), no reload by the test.
    await page.locator("[data-status-pill]", { hasText: /paid/i }).waitFor({
      timeout: 30_000,
    });
    await page.locator("[data-cy='claim-thanks']").waitFor({
      state: "detached",
      timeout: 15_000,
    });
  }));

Deno.test("REQ-321 M14: a tab opened on an already-claimed invoice flips to PAID by itself too", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const inv = await sentInvoice(http, auth, "Fence repair REQ-321 b");
    await post(http, JSON_HEADERS, `/api/invoices/${inv.id}/claim-payment`, {
      method: "zelle",
      reference: "ZL-322",
      claimedBy: "Juan",
    });

    await page.goto(`/i/${inv.id}`);
    const pill = page.locator("[data-status-pill]");
    await pill.waitFor({ timeout: 15_000 });
    expect(
      /awaiting confirmation/i.test(await pill.innerText()),
      `the page opens in the claimed state (${await pill.innerText()})`,
    );

    await post(http, auth, `/api/invoices/${inv.id}/confirm-payment`, {});
    await page.locator("[data-status-pill]", { hasText: /paid/i }).waitFor({
      timeout: 30_000,
    });
  }));

Deno.test("REQ-321 M14: /quotes moves a signed quote out of 'Out for response' without a reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const quote = await post(http, auth, "/api/quotes", {
      summary: "Deck rebuild REQ-321",
      jobName: "Deck rebuild REQ-321",
      lineItems: [{
        description: "Deck rebuild",
        quantity: 1,
        unit: "job",
        price: 100000,
      }],
      estimatedTotal: 100000,
      status: "draft",
    });
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    });
    await sent.body?.cancel();

    await page.goto("/quotes");
    const outTrack = page.locator(".qtrack", {
      has: page.locator(".qtrack__title", { hasText: "Out for response" }),
    });
    const card = outTrack.locator(".qcard", {
      hasText: "Deck rebuild REQ-321",
    });
    await card.waitFor({ timeout: 15_000 });

    // The customer signs on their own device.
    await post(http, JSON_HEADERS, `/api/quotes/${quote.id}/accept`, {
      name: "Juan Pérez",
      signature: "data:image/png;base64,iVBORw0KGgo=",
    });

    // The owner comes back to the tab: the list re-reads on focus.
    await page.evaluate(() => globalThis.dispatchEvent(new Event("focus")));
    await card.waitFor({ state: "detached", timeout: 30_000 });
    const decided = page.locator(".qtrack", {
      has: page.locator(".qtrack__title", { hasText: "Decided this month" }),
    });
    // the decided track lists rows (DecidedRow), not cards
    await decided.locator(".qdone", { hasText: "Deck rebuild REQ-321" })
      .waitFor({ timeout: 15_000 });
    expect(true, "the signed quote moved tracks without a reload");
  }));
