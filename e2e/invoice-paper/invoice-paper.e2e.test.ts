/**
 * REQ-922 — Raphael: "we need one more option to send invoice which is
 * 'paper' this saves the invoice as a pdf and adds it to pending and not
 * drafts."
 *
 * A draft invoice on /invoices: Finish + send → the send sheet offers
 * Paper; picking it asks for no email or phone and its Send reads "Save PDF".
 * Send → the browser downloads INV-….pdf (a real PDF), the card leaves
 * Drafting for Out for payment, the page says so in green, and the API
 * reads the invoice as sent.
 *
 * Page: front-end/islands/InvoicesPage.tsx (useInvoiceDispatch →
 * dispatchInvoice → dispatchPaper → POST /invoices/:id/paper).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Paper Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

function card(page: StoryTools["page"], jobName: string) {
  return page.locator("article.qcard", {
    has: page.locator("[data-cy='invoice-card-job']", { hasText: jobName }),
  }).first();
}

Deno.test("REQ-922: Paper in the send sheet saves the invoice's PDF and moves it from Drafting to Out for payment", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    // a client with NO email or phone: Paper still goes
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Walter Pruitt" }),
    })).json();
    const job = `Fence stain ${digits()}`;
    const created = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        jobName: job,
        status: "draft",
        netDays: 15,
        lineItems: [{
          description: job,
          quantity: 1,
          unit: "job",
          price: 32000,
        }],
        amount: 32000,
      }),
    })).json();
    if (!created?.id) throw new Error(`seed: ${JSON.stringify(created)}`);

    await page.goto("/invoices");
    const cta = card(page, job).locator("[data-cy='invoice-cta-drafting']");
    await cta.waitFor({ timeout: 20_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    // a click before hydration is lost — click until the sheet opens
    const sheet = page.locator("[data-cy='send-dialog']");
    for (let i = 0; i < 20 && !(await sheet.count()); i++) {
      await cta.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    await sheet.waitFor({ timeout: 15_000 });

    const paper = page.locator("[data-cy='send-option-paper']");
    await paper.click();
    expect.eq(await paper.getAttribute("aria-checked"), "true", "Paper picked");
    expect.eq(
      await page.locator(
        "[data-cy='send-add-email'], [data-cy='send-add-phone']",
      )
        .count(),
      0,
      "Paper asks for no email or phone",
    );
    await page.locator("[data-cy='send-paper-note']").waitFor();
    expect.eq(
      (await page.locator("[data-cy='send-keep']").innerText()).trim(),
      "Save PDF",
      "Send reads Save PDF",
    );

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      page.locator("[data-cy='send-keep']").click(),
    ]);
    expect.eq(
      download.suggestedFilename(),
      `${created.number}.pdf`,
      "the PDF is named after the invoice",
    );
    const path = await download.path();
    const head = new TextDecoder().decode(
      (await Deno.readFile(path!)).slice(0, 5),
    );
    expect.eq(head, "%PDF-", "a real PDF");

    const out = await card(page, job).locator("[data-cy='invoice-cta-out']")
      .waitFor({ timeout: 15_000 }).then(() => true, () => false);
    expect(out, "the card is in Out for payment");
    expect.eq(
      await card(page, job).locator("[data-cy='invoice-cta-drafting']").count(),
      0,
      "not in Drafting",
    );
    const flash = page.locator("[data-cy='invoice-sent']");
    await flash.waitFor({ timeout: 10_000 });
    expect.eq(
      (await flash.innerText()).trim(),
      `${created.number} saved as a PDF — it's in Out for payment.`,
      "the page says where it went",
    );

    const after = await (await http(`/api/invoices/${created.id}`, {
      headers: auth,
    })).json();
    expect.eq(after.status, "sent", "the API reads it as sent");
  }));
