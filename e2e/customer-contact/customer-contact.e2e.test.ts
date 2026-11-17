/**
 * REQ-278 (demo M16) — "fix every issue the demo found": bad phones ("123",
 * "555-12", "512-555-01") and emails ("davis@@gmail") were accepted and saved
 * as a customer's contact. The /customers "New customer" modal
 * (front-end/islands/ClientsPage.tsx) now refuses them with a visible
 * message, and nothing is saved; a good contact still saves.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ phoneNumber: phone, code: "000000" }) });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: body.recoveryToken }) });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", { method: "PUT", headers: auth, body: JSON.stringify({ language: "en", name: "Contact Story" }) });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [{ name, value, domain, path: "/" }, { name: "pm_lang", value: "en", domain, path: "/" }]));
  return { auth };
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(page: StoryTools["page"], selector: string, done: () => Promise<boolean>): Promise<void> {
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

Deno.test("REQ-278 M16: the New customer modal refuses '555-12' and 'davis@@gmail', saves nothing, then saves a good contact", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await page.goto("/customers");
    const modal = page.locator("form").filter({ hasText: "New customer" });
    await clickUntil(page, "button.ph2__cta", async () => (await modal.count()) > 0);

    const inputs = modal.locator("input");
    await inputs.nth(0).fill("Davis");
    await modal.locator("input[type='tel']").fill("555-12");
    await modal.locator("button[type='submit']").click();
    await expect.see("Enter a full phone number");

    await modal.locator("input[type='tel']").fill("");
    // type=email would let the browser bubble "davis@@gmail" — bypass it to prove OUR check runs
    await modal.evaluate((f) => f.setAttribute("novalidate", ""));
    await modal.locator("input[type='email']").fill("davis@@gmail");
    await modal.locator("button[type='submit']").click();
    await expect.see("Enter a valid email address");

    const none = await http("/api/customers", { headers: auth });
    const listed = await none.json();
    expect(listed.length === 0, `nothing saved after the refusals (${listed.length})`);

    await modal.locator("input[type='email']").fill("davis@gmail.com");
    await modal.locator("input[type='tel']").fill("5125550199");
    await modal.locator("button[type='submit']").click();
    await expect.see("Davis");
    for (let i = 0; i < 20; i++) {
      const r = await http("/api/customers", { headers: auth });
      const cs = await r.json();
      if (cs.length === 1) {
        expect(cs[0].email === "davis@gmail.com", `email saved (${cs[0].email})`);
        return;
      }
      await page.waitForTimeout(250);
    }
    throw new Error("the good contact was never saved");
  }));
