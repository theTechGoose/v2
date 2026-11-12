/**
 * REQ-486 (demo-loop cycle 3, issue m32) on the real shell — a New invoice
 * with "What's it for" + Amount and no line rows does not warn "No line
 * items", and the issued invoice carries that label as one itemized line.
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
    body: JSON.stringify({ language: "en", name: "Amount Only Story" }),
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
      // the button is gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

async function mkCustomer(
  http: StoryTools["http"],
  auth: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  return await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Ann Lee",
      email: "ann.lee@blackhole.postmarkapp.com",
      phoneNumber: "+15125550199",
      address: "1 Main St, Austin, TX 78701",
      ...extra,
    }),
  })).json();
}

Deno.test("REQ-486 m32: What's it for + $320, no line rows → no 'No line items' warning, and the invoice is issued with one line 'Gutter cleaning' × 1 @ $320", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await mkCustomer(http, auth);

    await page.goto("/invoices");
    await clickUntil(
      page,
      "[data-cy='invoice-new']",
      async () =>
        await page.locator("[data-cy='new-invoice-modal']").isVisible(),
    );
    await page.locator("[data-cy='new-invoice-client']").selectOption(
      customer.id,
    );
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-bill-email']") as
        | HTMLInputElement
        | null)?.value ===
        "ann.lee@blackhole.postmarkapp.com"
    );
    await page.locator("[data-cy='new-invoice-jobname']").fill(
      "Gutter cleaning",
    );
    await page.locator("[data-cy='new-invoice-amount']").fill("320");
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-total']")?.textContent ??
        "").includes("$320.00")
    );
    const missing = await page.locator("[data-cy='new-invoice-missing']")
        .count() > 0
      ? await page.locator("[data-cy='new-invoice-missing']").innerText()
      : "";
    expect.eq(
      missing.includes("No line items"),
      false,
      `an amount-only bill does not warn "No line items" (got: ${
        JSON.stringify(missing)
      })`,
    );

    await page.locator("[data-cy='new-invoice-submit']").click();
    await page.locator("[data-cy='invoice-card-headline']").first().waitFor({
      timeout: 15_000,
    });
    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json() as Array<Record<string, unknown>>;
    expect.eq(invoices.length, 1, "one invoice was created");
    const inv = invoices[0];
    expect.eq(inv.amount, 32000, "the amount is the typed $320");
    expect.eq(
      JSON.stringify(
        ((inv.lineItems ?? []) as Array<Record<string, unknown>>).map((l) => ({
          description: l.description,
          quantity: l.quantity,
          price: l.price,
        })),
      ),
      JSON.stringify([{
        description: "Gutter cleaning",
        quantity: 1,
        price: 32000,
      }]),
      "What's it for + amount became one itemized line",
    );
  }));
