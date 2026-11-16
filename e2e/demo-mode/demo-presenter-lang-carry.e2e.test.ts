/**
 * REQ-829 (demo-loop cycle dm2, issue m7) — "Stage and /admin after End are Spanish although the
 * presenter used /admin in English (pm_lang=en cookie ignored)". Hans's profile is Spanish (a new
 * account is born es, REQ-590); he works on /admin?lang=en (REQ-592: page-scoped). Pressing Demo
 * must open an English stage (<html lang="en">), and End must hand him back an English /admin.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function verify(http: StoryTools["http"], phone: string) {
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
  return { body, cookie, auth: { ...JSON_HEADERS, cookie } };
}

// deno-lint-ignore no-explicit-any
async function useCookie(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
}

async function profile(
  http: StoryTools["http"],
  auth: Record<string, string>,
  name: string,
  language: "en" | "es",
) {
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language, name }),
  })).body?.cancel();
}

Deno.test("REQ-829 (cycle dm2, m7): an es-profile presenter on /admin?lang=en presses Demo — the stage is <html lang='en'>, and after End /admin is English", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const hansPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await profile(http, user.auth, "Maria Lopez", "es");
    const hans = await verify(http, hansPhone);
    await profile(http, hans.auth, "Hans", "es");
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: hansPhone }),
    });
    expect.eq(boot.status, 200, "Hans is a super admin");
    await boot.body?.cancel();

    await useCookie(page.context(), baseUrl, hans.cookie);
    await page.goto(`${baseUrl}/admin?lang=en`);
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "/admin?lang=en is English",
    );
    await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
    await page.locator("[data-cy='adm-search']").click();
    await page.locator("[data-cy='adm-demo']").first().waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='adm-demo']").first().click();
    await page.waitForURL((u) => u.pathname === "/demo/stage", {
      timeout: 20_000,
    });
    await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
    await page.waitForLoadState("load");
    await page.waitForTimeout(1_500);

    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "the stage's <html lang> is the language the presenter was viewing",
    );
    expect.eq(
      await page.title(),
      "Demo mode · DocuMonster",
      "the stage's title is English",
    );

    await page.locator("[data-cy='demo-end']").click();
    await page.locator("[data-cy='demo-end-confirm']").click();
    await page.waitForURL((u) => u.pathname === "/admin", { timeout: 20_000 });
    await page.waitForLoadState("load");
    await page.waitForTimeout(1_500);
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "/admin after End is English",
    );
    const body = await page.locator("body").innerText();
    expect(
      body.includes("You ended the demo"),
      `/admin after End says "You ended the demo" in English: ${
        body.slice(0, 400)
      }`,
    );
    expect(
      !body.includes("Terminaste la demo"),
      "no Spanish ended notice",
    );
  }));
