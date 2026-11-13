/**
 * REQ-599 (demo-loop cycle 4, demo m30) — "fix every issue the demo found,
 * loop until there are none". The demo's New customer modal on /customers had
 * no address field, so a customer added there showed "No address on file"
 * ("Sin dirección registrada"). The modal now has an optional Address field
 * with the street autocomplete (typed text always the first option), and the
 * address is saved with the customer and shown on the card.
 *
 * Page: /customers (front-end/islands/ClientsPage.tsx).
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
    body: JSON.stringify({ language: "en", name: "Address Story" }),
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

Deno.test("REQ-599 m30: the New customer modal takes an address (autocomplete, typed text first) and the card shows it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await page.goto("/customers");
    const modal = page.locator("form[role='dialog']");
    await clickUntil(
      page,
      "button.ph2__cta",
      async () => (await modal.count()) > 0,
    );
    await expect.see("Address (optional)");

    await modal.locator("input").nth(0).fill("Bob Builder");
    const address = modal.locator("[data-cy='cf-street']");
    expect.eq(
      await address.getAttribute("role"),
      "combobox",
      "the address field is an autocomplete combobox",
    );
    await address.fill("1600 Congress Ave, Austin, TX 78701");
    // the typed text is always the first option, whatever Mapbox knows
    const typed = modal.locator("[data-cy='cf-street-typed']");
    await typed.waitFor({ timeout: 5_000 });
    await typed.click();
    expect.eq(
      await address.inputValue(),
      "1600 Congress Ave, Austin, TX 78701",
      "picking 'Use as typed' keeps the text",
    );

    await modal.locator("button[type='submit']").click();
    await expect.see("Bob Builder added");

    const list = await (await http("/api/customers", { headers: auth })).json();
    const bob = list.find((c: { name: string }) => c.name === "Bob Builder");
    expect.eq(
      bob?.address,
      "1600 Congress Ave, Austin, TX 78701",
      "the address is saved with the customer",
    );
    // the card's panel shows it instead of "No address on file"
    const card = page.locator(".ccard2").filter({ hasText: "Bob Builder" });
    await clickUntil(
      page,
      ".ccard2:has-text('Bob Builder') .ccard2__name",
      async () =>
        ((await card.first().getAttribute("class")) ?? "").includes(
          "ccard2--open",
        ),
    );
    await expect.see("1600 Congress Ave, Austin, TX 78701");
    expect(
      !(await card.textContent() ?? "").includes("No address on file"),
      "the card no longer says 'No address on file'",
    );
  }));
