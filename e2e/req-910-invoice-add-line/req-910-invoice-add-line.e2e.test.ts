/**
 * REQ-910 — Johanna (A2Z), 2026-11-16, video 3 + the invoice photos: "Este
 * invoice le faltó agregar el 10% y no tenemos la opción de editarlo." On a
 * SENT invoice, Edit shows every line with a remove button, an add button and
 * "10 % of the lines above → Add as Overhead line"; Save keeps it as the
 * pending revision (the customer still sees $350), Publish makes Version 2
 * and the customer's page reads $385.
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
    body: JSON.stringify({ language: "en", name: "Add Line Story" }),
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

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  url: string,
  body: unknown,
) {
  const r = await http(url, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

Deno.test("REQ-910: a sent invoice takes a 10% Overhead line in Edit — pending until Publish, then Version 2 and $385 on the customer's page", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const name = `Robert Frakes ${digits()}`;
    const customer = await post(http, auth, "/api/customers", {
      name,
      email: "rf@blackhole.postmarkapp.com",
    });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: "Maintenance 2026-10-01 → 2026-10-31",
      lineItems: [2, 9, 16, 23, 30].map((d) => ({
        description: `Oct ${d} — Lawn`,
        quantity: 1,
        unit: "visit",
        price: 7000,
      })),
      amount: 35000,
      status: "sent",
      issuedDate: "2026-11-01",
      dueDate: "2026-12-01",
    });
    expect.eq(inv.version, 1, "a fresh sent invoice is version 1");

    await page.goto(`/invoices?open=${inv.id}`);
    const panel = page.locator("[data-cy='invoice-detail']");
    await panel.locator("[data-cy='invoice-edit']").waitFor({
      timeout: 15_000,
    });
    await panel.locator("[data-cy='invoice-edit']").click();
    const form = panel.locator("[data-cy='invoice-edit-form']");
    await form.waitFor({ timeout: 15_000 });
    const descs = form.locator("[data-cy^='invoice-edit-line-desc-']");
    await descs.nth(4).waitFor({ timeout: 15_000 });
    expect.eq(await descs.count(), 5, "the five visits are editable lines");
    expect.eq(
      await form.locator("[data-cy^='invoice-edit-line-remove-']").count(),
      5,
      "every line can be removed",
    );
    await form.locator("[data-cy='invoice-edit-line-add']").waitFor({
      timeout: 15_000,
    });

    // 10 % of the lines above → a sixth line, $35.00, flagged Overhead
    await form.locator("[data-cy='invoice-edit-pct']").fill("10");
    await form.locator("[data-cy='invoice-edit-pct-add']").click();
    const sixth = form.locator("[data-cy='invoice-edit-line-desc-5']");
    await sixth.waitFor({ timeout: 15_000 });
    expect.eq(await sixth.inputValue(), "Overhead", "the new line is Overhead");
    expect.eq(
      Number(
        await form.locator("[data-cy='invoice-edit-line-price-5']")
          .inputValue(),
      ),
      35,
      "priced at 10% of $350",
    );
    expect(
      await form.locator("[data-cy='invoice-edit-line-overhead-5'] input")
        .isChecked(),
      "the new line is flagged overhead",
    );

    // Save → the pending revision, the customer still on version 1
    const saved = page.waitForResponse((r) =>
      r.request().method() === "PUT" &&
      r.url().includes(`/api/invoices/${inv.id}`)
    );
    await form.locator("[data-cy='invoice-edit-save']").click();
    expect.eq((await saved).status(), 200, "the edit is saved");
    await panel.locator("[data-cy='invoice-pending-revision']").waitFor({
      timeout: 15_000,
    });
    const note = panel.locator("[data-cy='invoice-published-note']");
    await note.waitFor({ timeout: 15_000 });
    expect(
      /still sees the published version/.test(await note.innerText()),
      "the save says the customer still sees the published version",
    );
    const before = await (await http(`/api/invoices/${inv.id}/public`)).json();
    expect.eq(before.amount, 35000, "the customer still sees $350");

    // Publish quietly → Version 2
    const published = page.waitForResponse((r) =>
      r.request().method() === "POST" &&
      r.url().includes(`/api/invoices/${inv.id}/publish`)
    );
    await panel.locator("[data-cy='invoice-publish-quiet']").click();
    expect.eq((await published).status(), 200, "the revision is published");
    await panel.locator("text=/Version 2/").first().waitFor({
      timeout: 15_000,
    });

    // the customer's page reads the new total
    await page.goto(`/i/${inv.id}`);
    const amount = page.locator("[data-cy='invoice-amount']");
    await amount.waitFor({ timeout: 15_000 });
    expect(
      /385\.00/.test(await amount.innerText()),
      `the customer sees $385.00 (${await amount.innerText()})`,
    );
  }));
