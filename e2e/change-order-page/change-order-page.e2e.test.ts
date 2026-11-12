/**
 * REQ-398 — demo-loop cycle 2, issues M15 / m25 / p13-j: the public change
 * order page (/co/:id) in a browser.
 *
 *  - M15: the contractor's own browser sees "Preview — approving is
 *    disabled", never the approve form (REQ-306 parity with /q).
 *  - m25: the headline is the JOB total ($19,200 → $20,050) with "Added to
 *    INV-… ($9,600 → $10,450)" under it.
 *  - p13-j: the customer's link opens in its ?lang= and the EN | ES toggle
 *    switches it.
 *  - the open owner tab follows the customer's approval on its own.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function seed(http: StoryTools["http"]) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const call = async (path: string, payload: unknown, method = "POST") => {
    const res = await http(path, {
      method,
      headers: auth,
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  };
  await call("/api/me", { name: "CO Owner", language: "en" }, "PUT");
  await call("/api/profile/identity", {
    businessName: "Cambio Builders",
    commsLanguage: "es",
  }, "PUT");
  const customer = await call("/api/customers", {
    name: "Juan Pérez",
    phoneNumber: `+1512${digits()}`,
  });
  const quote = await call("/api/quotes", {
    customerId: customer.id,
    summary: "Kitchen remodel",
    lineItems: [{
      description: "Kitchen remodel",
      quantity: 1,
      unit: "job",
      price: 1_920_000,
    }],
    estimatedTotal: 1_920_000,
  });
  const invoice = await call("/api/invoices", {
    customerId: customer.id,
    quoteId: quote.id,
    jobName: "Kitchen remodel",
    lineItems: [{
      description: "Balance",
      quantity: 1,
      unit: "job",
      price: 960_000,
    }],
    amount: 960_000,
    dueDate: "2026-12-30",
  });
  const co = await call(`/api/invoices/${invoice.id}/change-orders`, {
    description: "Add pantry shelving",
    deltaAmountCents: 85_000,
  });
  return { cookie, coId: co.id as string };
}

Deno.test("REQ-398 M15/m25/p13-j: the owner previews /co (no approve form), sees the job total; the customer opens it in ?lang=es, toggles to EN and approves; the owner's open tab follows", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { cookie, coId } = await seed(http);
    const [name, value] = cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].flatMap((domain) => [
        { name, value, domain, path: "/" },
        { name: "pm_lang", value: "en", domain, path: "/" },
      ]),
    );
    await page.setViewportSize({ width: 1280, height: 900 });

    // 1. the owner's own browser: a preview, never the approve form
    await page.goto(`/co/${coId}`);
    await page.locator("[data-cy=co-internal-preview]").waitFor({
      timeout: 15_000,
    });
    await expect.see("approving is disabled");
    expect.eq(
      await page.locator("[data-cy=co-name]").count(),
      0,
      "no name field for the owner",
    );
    expect.eq(
      await page.getByRole("button", { name: "Approve this change" }).count(),
      0,
      "no approve button for the owner",
    );
    // m25: the job total is the headline; the invoice sits under it
    const job = await page.locator("[data-cy=co-job-total]").innerText();
    expect(
      job.includes("$19,200.00") && job.includes("$20,050.00"),
      `job total $19,200 → $20,050 (got "${job}")`,
    );
    const inv = await page.locator("[data-cy=co-invoice-delta]").innerText();
    expect(
      /Added to INV-\S+ \(\$9,600\.00 → \$10,450\.00\)/.test(inv),
      `invoice line (got "${inv}")`,
    );

    // 2. the customer: no session, the link carries ?lang=es
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const customerCtx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    try {
      const cx = await customerCtx.newPage();
      await cx.goto(`${baseUrl}/co/${coId}?lang=es`);
      await cx.getByRole("button", { name: "Aprobar este cambio" }).waitFor({
        timeout: 15_000,
      });
      expect.eq(
        await cx.locator("a[data-public-lang=es]").getAttribute("aria-current"),
        "true",
        "ES is current",
      );
      expect.eq(
        await cx.locator("[data-cy=co-internal-preview]").count(),
        0,
        "the customer sees no preview banner",
      );
      await cx.locator("a[data-public-lang=en]").click();
      await cx.getByRole("button", { name: "Approve this change" }).waitFor({
        timeout: 15_000,
      });
      expect.eq(
        new URL(cx.url()).search,
        "?lang=en",
        "the pick is on the link",
      );
      // the island may still be hydrating when the form appears (a value
      // typed before that never reaches its state): fill + click until the
      // decision lands, 2 s per try
      const approved = cx.locator("[data-cy=co-approved-by]");
      for (let i = 0; i < 10 && !(await approved.count()); i++) {
        try {
          await cx.locator("[data-cy=co-name]").fill("Juan Pérez", {
            timeout: 2_000,
          });
          await cx.getByRole("button", { name: "Approve this change" })
            .click({ timeout: 2_000 });
          await approved.waitFor({ timeout: 2_000 });
        } catch { /* not hydrated yet, or the page is reloading */ }
      }
      await cx.locator("[data-cy=co-approved-by]").waitFor({
        timeout: 15_000,
      });
      const head = await cx.locator("[data-cy=co-headline]").innerText();
      expect(/approved/i.test(head), `headline follows (got "${head}")`);
    } finally {
      await customerCtx.close();
    }

    // 3. the owner's open tab re-reads and shows the decision on its own
    await page.locator("[data-cy=co-internal-preview]").waitFor({
      state: "detached",
      timeout: 30_000,
    });
    await page.locator("[data-cy=co-approved-by]").waitFor({ timeout: 15_000 });
  }));
