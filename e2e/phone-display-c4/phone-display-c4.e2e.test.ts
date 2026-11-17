/**
 * REQ-593 (demo-loop cycle 4, m12) on the real app — phone numbers read like
 * phone numbers, not stored digits:
 *   - New invoice: picking a customer stored as "+15125550199" fills BILL TO
 *     phone as "(512) 555-0199";
 *   - /worker sign-in: typing "3055550142" into the cell shows
 *     "(305) 555-0142".
 * (Payment instructions from onboarding: e2e/new-invoice-defaults, REQ-483.)
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Phone Story" }),
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

Deno.test("REQ-593 m12: New invoice for a customer stored as +15125550199 shows BILL TO phone '(512) 555-0199'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Bob Raw",
        email: "bob.raw@blackhole.postmarkapp.com",
        phoneNumber: "+15125550199",
      }),
    })).json();
    await page.goto("/invoices?new=1");
    const select = page.locator("[data-cy='new-invoice-client']");
    await select.waitFor({ timeout: 15_000 });
    const phone = page.locator("[data-cy='new-invoice-bill-phone']");
    let shown = "";
    for (let i = 0; i < 20; i++) {
      await select.selectOption(customer.id).catch(() => {});
      await page.waitForTimeout(500);
      shown = await phone.inputValue().catch(() => "");
      if (shown) break;
    }
    expect.eq(shown, "(512) 555-0199", "BILL TO phone is formatted");
  }));

Deno.test("REQ-593 m12: /worker sign-in masks the cell as it is typed", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/worker");
    const cell = page.locator("[data-cy='w-cell']");
    await cell.waitFor({ timeout: 15_000 });
    let shown = "";
    for (let i = 0; i < 10; i++) {
      await cell.fill("");
      await cell.pressSequentially("3055550142");
      shown = await cell.inputValue();
      if (shown !== "3055550142") break; // hydrated: the mask applied
      await page.waitForTimeout(500);
    }
    expect.eq(shown, "(305) 555-0142", "the cell reads as a phone number");
  }));
