/**
 * REQ-1088 (LOOP-007 cycle 3, q3-5 / q3-6) on the real shell — a customer made
 * with lowercase address parts (QA5: "45 palmetto dr" / "conway" / "SC") and a
 * service address typed lowercase into the New invoice form (QA3: "4410 avenue
 * h, austin tx 78751") are printed tidy on the customer's /i/:id.
 */
import { story, type StoryTools } from "#shots";
import { ensureService, fillInvoiceLine } from "../_shared/service-lines.ts";

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
    body: JSON.stringify({ language: "en", name: "Address Tidy Story" }),
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

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-1088 (q3-5, q3-6): an invoice issued from New invoice with a lowercase service address and a lowercase customer prints both tidy on /i", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const labor = await ensureService(http, auth, "Labor");
    const cr = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Maria Jose Pena",
        email: "maria.pena@blackhole.postmarkapp.com",
        street: "45 palmetto dr",
        city: "conway",
        state: "SC",
        zip: "29526",
      }),
    });
    const customer = await cr.json();
    expect(cr.ok, `customer create → ${cr.status}`);

    await page.goto("/invoices");
    await clickUntil(
      page,
      "[data-cy='invoice-new']",
      async () =>
        await page.locator("[data-cy='new-invoice-modal']").isVisible(),
    );
    const clientBox = page.locator(
      "[data-cy='new-invoice-client'] [data-cy='search-select-input']",
    );
    await clientBox.waitFor({ timeout: 15_000 });
    await clientBox.fill("Maria");
    await page.locator(
      "[data-cy='new-invoice-client'] [data-cy='search-select-option']",
    ).filter({ hasText: "Maria Jose Pena" }).first().click();
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-bill-email']") as
        | HTMLInputElement
        | null)?.value === "maria.pena@blackhole.postmarkapp.com"
    );
    // QA3 typed the job address by hand, all lowercase
    await page.locator("[data-cy='new-invoice-service-address']").fill(
      "4410 avenue h, austin tx 78751",
    );
    await fillInvoiceLine(page, 0, labor, "320");
    await page.locator("[data-cy='new-invoice-submit']").click();
    await page.locator("[data-cy='send-dialog']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='send-keep']").click();
    await page.locator("[data-cy='invoice-card-headline']").first().waitFor({
      timeout: 15_000,
    });

    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json() as Array<Record<string, unknown>>;
    const inv = invoices.find((i) => i.customerId === customer.id);
    expect(!!inv, "the invoice was created");

    // the customer's view, signed out
    await page.context().clearCookies();
    await page.context().addCookies([{
      name: "pm_lang",
      value: "en",
      domain: new URL(baseUrl).hostname,
      path: "/",
    }]);
    await page.goto(`/i/${inv!.id}`);
    const svc = page.locator("[data-cy='invoice-service-address']");
    await svc.waitFor({ timeout: 15_000 });
    const svcText = (await svc.innerText()).trim();
    expect(
      svcText.endsWith("4410 Avenue H, Austin, TX 78751"),
      `the service address on /i is tidy (got ${JSON.stringify(svcText)})`,
    );
    const parties = (await page.locator("[data-cy='invoice-parties']")
      .innerText()).trim();
    expect(
      parties.includes("45 Palmetto Dr, Conway, SC 29526"),
      `the bill-to address on /i is tidy (got ${JSON.stringify(parties)})`,
    );
  }));
