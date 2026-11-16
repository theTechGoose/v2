/**
 * REQ-861 (demo-loop cycle dm4, issue setup-2) — "fix every issue the demo
 * found, loop until there are none". A tester typed "123 Congress Ave" on
 * /settings#address and no address suggestions appeared: the mailing-address
 * card was plain text boxes, unlike the onboarding wizard and the New customer
 * modal (REQ-599). Now its street line is the same autocomplete: the typed
 * text is always the first option ("Use as typed" — the only row on a VM with
 * no MAPBOX_TOKEN), and picking a Mapbox suggestion fills street, city, state
 * and ZIP and autosaves them.
 *
 * Page: /settings (front-end/islands/SettingsPage.tsx AddressEditCard).
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Address Suggest Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
}

const CARD = "[data-cy='settings-mailing-address']";
const FEATURE = {
  properties: {
    name: "123 Congress Ave",
    context: {
      address: { name: "123 Congress Ave" },
      place: { name: "Austin" },
      region: { region_code: "TX" },
      postcode: { name: "78701" },
    },
  },
};

/** typing before hydration is lost: retype until the list's first row shows */
async function typeUntilList(
  page: StoryTools["page"],
  text: string,
): Promise<boolean> {
  const street = page.locator(`${CARD} [data-cy='settings-street']`);
  const typed = page.locator(`${CARD} [data-cy='settings-street-typed']`);
  for (let attempt = 0; attempt < 10; attempt++) {
    await street.fill("");
    await street.pressSequentially(text);
    for (let i = 0; i < 10; i++) {
      if (await typed.isVisible()) return true;
      await page.waitForTimeout(200);
    }
  }
  return false;
}

Deno.test("REQ-861 dm4 setup-2: the /settings street line shows 'Use as typed' with no Mapbox rows (the VM case)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    // a VM has no MAPBOX_TOKEN: the proxy answers no features
    await page.route("**/api/geocode?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ features: [] }),
      }));
    await page.goto("/settings#address");
    await page.locator(CARD).waitFor({ timeout: 20_000 });
    expect(
      (await page.locator(`${CARD} [data-cy='settings-street']`).count()) === 1,
      "the card's street line is the autocomplete field",
    );
    expect(
      await typeUntilList(page, "123 Congress Ave"),
      "typing a street shows the suggestion list",
    );
    const typed = page.locator(`${CARD} [data-cy='settings-street-typed']`);
    expect.eq(
      (await typed.innerText()).replace(/\s+/g, " ").trim(),
      "123 Congress Ave Use as typed",
      "the first row is the typed text, 'Use as typed'",
    );
  }));

Deno.test("REQ-861 dm4 setup-2: picking a suggestion fills street, city, state and ZIP and saves them", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.route("**/api/geocode?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ features: [FEATURE] }),
      }));
    await page.goto("/settings#address");
    const card = page.locator(CARD);
    await card.waitFor({ timeout: 20_000 });
    expect(await typeUntilList(page, "123 Congr"), "the list opens");
    const row = card.getByRole("option").filter({
      hasText: "123 Congress Ave, Austin, TX 78701",
    });
    await row.waitFor({ timeout: 5_000 });
    await row.locator("button").click();

    const inputs = card.locator("input");
    const values = async () =>
      await Promise.all([0, 1, 2, 3].map((i) => inputs.nth(i).inputValue()));
    expect.eq(
      (await values()).join(" | "),
      "123 Congress Ave | Austin | TX | 78701",
      "street, city, state and ZIP filled from the pick (input order kept)",
    );
    let savedSeen = false;
    for (let i = 0; i < 25 && !savedSeen; i++) {
      savedSeen = (await card.getByText("Saved").count()) > 0;
      if (!savedSeen) await page.waitForTimeout(200);
    }
    expect(savedSeen, "the pick autosaved (the card says Saved)");

    await page.reload();
    await card.waitFor({ timeout: 20_000 });
    expect.eq(
      (await values()).join(" | "),
      "123 Congress Ave | Austin | TX | 78701",
      "the picked address persisted",
    );
  }));
