/**
 * REQ-198 / REQ-199 — the Settings "Document numbering" card and the
 * "Reset test data" action in the danger zone, on the real shell.
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
    body: JSON.stringify({ language: "en", name: "Numbering Story" }),
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

async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
    } catch {
      // the button is gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

const text = (page: StoryTools["page"], selector: string) =>
  page.locator(selector).innerText().catch(() => "");

const numbering = (http: StoryTools["http"], auth: Record<string, string>) =>
  http("/api/profile/numbering", { headers: auth }).then((r) => r.json());

Deno.test("REQ-199: Settings shows the account number and the next numbers; a start saves and shows; an issued kind locks; the reset clears the records and keeps the starts", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const fresh = await numbering(http, auth);

    await page.goto("/settings");
    const card = page.locator("[data-cy='settings-numbering']");
    await card.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='settings-numbering-account']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await text(page, "[data-cy='settings-numbering-account']"),
      fresh.accountNumber,
      "the card shows the account number the API gives",
    );
    await expect.see("Your account number");
    expect.eq(
      await text(page, "[data-cy='settings-numbering-next-invoice']"),
      "Next: INV-001",
      "invoices start at 001",
    );
    expect.eq(
      await text(page, "[data-cy='settings-numbering-next-customer']"),
      "Next: C-001",
      "customers start at 001",
    );

    // set the invoice start to 5000 and save
    await page.locator("[data-cy='settings-numbering-start-invoice']").fill(
      "5000",
    );
    await clickUntil(
      page,
      "[data-cy='settings-numbering-save']",
      async () =>
        (await text(page, "[data-cy='settings-numbering-next-invoice']")) ===
          "Next: INV-5000",
    );
    expect.eq(
      await text(page, "[data-cy='settings-numbering-next-invoice']"),
      "Next: INV-5000",
      "the next invoice number follows the start",
    );
    const saved = await numbering(http, auth);
    expect.eq(
      saved.settings.invoiceStart,
      5000,
      "the API holds invoiceStart 5000",
    );
    expect.eq(
      saved.next.invoice,
      "INV-5000",
      "the API's next invoice is INV-5000",
    );

    // issue an invoice → the invoice row is locked
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ amount: 100 }),
    })).json();
    expect.eq(inv.number, "INV-5000", "the invoice took INV-5000");
    const issued = await numbering(http, auth);
    expect.eq(issued.issued.invoice, true, "the API says invoices issued");

    await page.reload();
    await page.locator("[data-cy='settings-numbering-lock-invoice']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await text(page, "[data-cy='settings-numbering-lock-invoice']"),
      "Locked — INV-5000 is already in use",
      "the invoice row carries the lock note",
    );
    expect(
      await page.locator("[data-cy='settings-numbering-start-invoice']")
        .isDisabled(),
      "the invoice start input is disabled",
    );
    expect.eq(
      await text(page, "[data-cy='settings-numbering-next-invoice']"),
      "Next: INV-5001",
      "the next invoice advanced",
    );

    // another kind still saves
    await page.locator("[data-cy='settings-numbering-start-customer']").fill(
      "100",
    );
    await clickUntil(
      page,
      "[data-cy='settings-numbering-save']",
      async () =>
        (await text(page, "[data-cy='settings-numbering-next-customer']")) ===
          "Next: C-100",
    );
    expect.eq(
      (await numbering(http, auth)).next.customer,
      "C-100",
      "the API's next customer is C-100",
    );

    // reset test data through the modal
    await clickUntil(
      page,
      "[data-cy='settings-reset-open']",
      async () =>
        await page.locator("[data-cy='settings-reset-modal']").isVisible()
          .catch(() => false),
    );
    await expect.see("Reset test data");
    const keyword =
      (await page.locator("[data-cy='settings-reset-confirm-input']")
        .getAttribute("placeholder")) ?? "RESET";
    await page.locator("[data-cy='settings-reset-confirm-input']").fill(
      keyword,
    );
    await clickUntil(
      page,
      "[data-cy='settings-reset-confirm']",
      async () =>
        await page.locator("[data-cy='settings-reset-done']").isVisible().catch(
          () => false,
        ),
    );
    await expect.see(
      "Test data cleared — numbering restarts at your starting numbers",
    );
    const listRes = await http("/api/invoices", { headers: auth });
    const listBody = await listRes.text();
    expect.eq(
      listRes.status,
      200,
      `GET /api/invoices answers 200 (${listBody.slice(0, 160)})`,
    );
    const invoices = JSON.parse(listBody || "null");
    expect(
      Array.isArray(invoices) && invoices.length === 0,
      `GET /api/invoices is [] after the reset (${listBody.slice(0, 160)})`,
    );
    const after = await numbering(http, auth);
    expect.eq(after.issued.invoice, false, "the API says nothing issued");
    expect.eq(after.next.invoice, "INV-5000", "the API kept the start");
    await page.locator("[data-cy='settings-numbering-lock-invoice']").waitFor({
      state: "hidden",
      timeout: 15_000,
    });
    expect(
      !(await page.locator("[data-cy='settings-numbering-start-invoice']")
        .isDisabled()),
      "the invoice start input is editable again",
    );
    expect.eq(
      await text(page, "[data-cy='settings-numbering-next-invoice']"),
      "Next: INV-5000",
      "the card shows the kept start",
    );
    expect.eq(
      await text(page, "[data-cy='settings-numbering-account']"),
      fresh.accountNumber,
      "the account number did not change",
    );
  }));
