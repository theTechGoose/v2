/**
 * REQ-1119 (LOOP-007 cycle 3, q3-45 / q3-46 / q3-47) — the New invoice
 * form's Bill to → Phone follows the ONE phone rule (REQ-1080).
 *
 * The tester typed "843-555-0145 x12" into Bill to → Phone. The field showed
 * "(843) 555-0145" (the extension hidden by formatPhoneInput), nothing was
 * flagged, Issue went ahead, the send sheet recommended "Text + Email", and
 * the text failed with "invalid phone: 843-555-0145 x12". The customer's /i
 * showed the raw "843-555-0145 x12" and the customer page read "Phone —".
 *
 * Now: the field keeps what was typed visible, names the problem under it on
 * blur, and Issue creates nothing.
 *
 * Page: /invoices?new=1 (front-end/islands/InvoicesPage.tsx NewInvoiceModal).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const EXT = "843-555-0145 x12";
const BAD_PHONE_COPY = "Enter a full phone number";

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
    body: JSON.stringify({ language: "en", name: "Bill Phone Story" }),
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

async function until(
  page: StoryTools["page"],
  act: () => Promise<void>,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await act();
    } catch { /* not ready yet */ }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error("the action never took");
}

Deno.test("REQ-1119 q3-45/q3-46/q3-47: New invoice → Bill to Phone '843-555-0145 x12' keeps the extension visible, is named under the field on blur, and Issue creates no invoice, no customer and no send sheet", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/api\/invoices\/?$/.test(r.url())) {
        posts.push(r.url());
      }
    });
    await page.goto("/invoices?new=1");
    const modal = page.locator("[data-cy='new-invoice-modal']");
    await modal.waitFor({ timeout: 20_000 });
    const name = page.locator("[data-cy='new-invoice-bill-name']");
    await until(
      page,
      async () => await name.fill("Greg"),
      async () => (await name.inputValue()) === "Greg",
    );
    await page.locator("[data-cy='new-invoice-bill-email']").fill(
      "greg@example.com",
    );
    await page.locator("[data-cy='new-invoice-amount']").fill("300");

    // the tester's step: the phone with an extension, then leave the field
    const phone = page.locator("[data-cy='new-invoice-bill-phone']");
    await phone.fill(EXT);
    await phone.blur();
    await page.waitForTimeout(500);
    const shown = await phone.inputValue();
    expect(
      /x\s*12/.test(shown),
      `the field shows what will be saved, never a cleaned number hiding the extension (shows ${
        JSON.stringify(shown)
      })`,
    );
    const err = page.locator("[data-cy='new-invoice-billPhone-err']");
    expect.eq(
      await err.count() > 0 && await err.isVisible(),
      true,
      "an inline error sits under Bill to → Phone after blur",
    );
    expect(
      ((await err.textContent()) ?? "").includes(BAD_PHONE_COPY),
      "the error is the one phone rule's copy (customer.invalidPhone)",
    );
    expect.eq(
      await phone.getAttribute("aria-invalid"),
      "true",
      "the Bill-to phone is flagged invalid",
    );

    // Issue is refused: nothing posted, no send sheet, nothing stored
    await page.locator("[data-cy='new-invoice-submit']").click();
    await page.waitForTimeout(1_500);
    expect.eq(posts.length, 0, "Issue never posts the invoice");
    expect.eq(
      await page.locator("[data-cy='send-dialog']").count(),
      0,
      "the send sheet never opens",
    );
    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json();
    expect.eq(invoices.length, 0, "no invoice was created");
    const customers = await (await http("/api/customers", { headers: auth }))
      .json();
    expect.eq(customers.length, 0, "no customer was created");
  }));
