/**
 * REQ-812 (demo-loop cycle dm1, issue p2) — the second demo's stage page was half Spanish
 * (<html lang="es">, tab title "Modo demo · DocuMonster") and half English (the pill). Under
 * impersonation the shell resolved the CUSTOMER's language (Spanish after they switched in an
 * earlier demo) and HtmlLang's on-mount title heal (REQ-709) rewrote the presenter's English title.
 * The customer's profile is Spanish, Hans's English: Hans's stage is English throughout — <html
 * lang>, the tab title (still English after HtmlLang mounts) and the pill.
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

Deno.test("REQ-812 (cycle dm1, p2): customer es + presenter en — the stage is English throughout: <html lang='en'>, the title stays 'Demo mode · DocuMonster' after HtmlLang mounts, the pill in English", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const hansPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await profile(http, user.auth, "Maria Lopez", "es");
    const hans = await verify(http, hansPhone);
    await profile(http, hans.auth, "Hans", "en");
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: hansPhone }),
    });
    expect.eq(boot.status, 200, "Hans is a super admin");
    await boot.body?.cancel();

    await useCookie(page.context(), baseUrl, hans.cookie);
    await page.goto(`${baseUrl}/admin`);
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
    // every island has hydrated and HtmlLang's mount effect has run by now
    await page.waitForLoadState("load");
    await page.waitForTimeout(1_500);

    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "<html lang> is the presenter's",
    );
    expect.eq(
      await page.title(),
      "Demo mode · DocuMonster",
      "the tab title stays English after HtmlLang mounts",
    );
    const pill = (await page.locator("[data-cy='demo-pill']").innerText())
      .trim();
    expect(/Demo mode/.test(pill), `the pill is English: ${pill}`);

    // clean up: Hans ends it
    await page.locator("[data-cy='demo-end']").click();
    await page.locator("[data-cy='demo-end-confirm']").click();
    await page.waitForURL(/\/admin/, { timeout: 20_000 });
  }));
