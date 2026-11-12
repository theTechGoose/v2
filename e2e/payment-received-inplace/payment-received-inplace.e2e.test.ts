/**
 * REQ-489 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3 (run re05e1cbb), issue p8-pair1-d: "'Payment
 * received' does a full page load". RCA (CONFIRMED / UPHELD at cc5d4b0e):
 * InvoiceCard's doPaymentReceived ran
 * `location.assign('/invoices?open=<id>&pay=1')` from /invoices itself.
 *
 * On /invoices, the card's "Payment received" opens that invoice's detail
 * in pay mode IN PLACE: the document is not reloaded (a window marker
 * survives), the pay form shows, and the URL reads ?open=<id>&pay=1. With
 * another invoice's detail already open, it switches to the clicked one
 * in pay mode.
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
    body: JSON.stringify({ language: "en", name: "In Place Story" }),
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

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function sentInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customerId: string,
  jobName: string,
) {
  return await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId,
      status: "sent",
      issuedDate: inDays(0),
      jobName,
      dueDate: inDays(14),
      lineItems: [{
        description: jobName,
        quantity: 1,
        unit: "job",
        price: 6500,
      }],
      amount: 6500,
    }),
  })).json();
}

Deno.test("REQ-489 (demo p8-pair1-d, cycle 3): 'Payment received' on /invoices opens the pay form in place — no page load", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Randall Belknap",
        email: "rb@blackhole.postmarkapp.com",
      }),
    })).json();
    const a = await sentInvoice(http, auth, customer.id, "Front gate");
    const b = await sentInvoice(http, auth, customer.id, "Back fence");

    let docLoads = 0;
    page.on("request", (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        docLoads++;
      }
    });

    // Another invoice's detail is already open (not in pay mode).
    await page.goto(`/invoices?open=${a.id}`);
    const cardB = page.locator("article.qcard", {
      has: page.locator("[data-cy='invoice-card-job']", {
        hasText: "Back fence",
      }),
    }).first();
    const cta = cardB.locator("[data-cy='invoice-cta-out']");
    await cta.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='invoice-detail']").waitFor({
      timeout: 15_000,
    });
    // Islands hydrated before the click (a pre-hydration click is a no-op).
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.evaluate(() => {
      (globalThis as unknown as { __req489: number }).__req489 = 1;
    });
    const loadsBefore = docLoads;

    await cta.click();
    await page.locator("[data-cy='pay-received-form']").waitFor({
      timeout: 15_000,
    });

    const marker = await page.evaluate(() =>
      (globalThis as unknown as { __req489?: number }).__req489 ?? null
    );
    expect.eq(marker, 1, "the document was not reloaded (window marker kept)");
    expect.eq(docLoads - loadsBefore, 0, "no navigation request left the page");
    const url = new URL(page.url());
    expect.eq(url.pathname, "/invoices", `path (${page.url()})`);
    expect.eq(url.searchParams.get("open"), b.id, `open= (${page.url()})`);
    expect.eq(url.searchParams.get("pay"), "1", `pay= (${page.url()})`);
    const detailText = await page.locator("[data-cy='invoice-detail']")
      .innerText();
    expect(
      detailText.includes("Back fence"),
      `the detail shows the clicked invoice (${detailText.slice(0, 200)})`,
    );
  }));
