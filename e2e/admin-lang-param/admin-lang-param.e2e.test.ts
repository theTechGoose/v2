/**
 * REQ-592 — demo-loop cycle 4, issue m5: a staff account whose language is
 * "es" opened /admin?lang=en. The page painted English, then the footer read
 * "Políticas" and, once the staff member saved a name, the whole page turned
 * Spanish (fleet-0 stdout:55, fleet-6 stdout:62). The route's own language
 * ignored ?lang=, and the dashboard cache's profile seed overrode it.
 * Run with SUPERADMIN_BOOTSTRAP_TOKEN set (shots' serve is stamped DENO_DEPLOY=true).
 */
import { story } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

Deno.test("REQ-592 (m5): an es staff member on /admin?lang=en stays English — the footer at first paint, and after saving a name", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const phone = `+1512${digits()}`;
    let r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    let body = await r.json();
    let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    if (body.recoverable === true) {
      r = await http("/api/auth/start-fresh", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ token: body.recoveryToken }),
      });
      body = await r.json();
      cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    }
    if (!cookie) {
      throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
    }
    const auth = { ...JSON_HEADERS, cookie };
    // the account was made through the Spanish-first /login: language "es"
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "es" }),
    })).body?.cancel();
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        phoneNumber: phone,
        token: Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN") ?? "",
      }),
    });
    expect.eq(boot.status, 200, `bootstrap super admin (${await boot.text()})`);
    const [name, value] = cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies([...hosts].map((domain) => ({
      name,
      value,
      domain,
      path: "/",
    })));

    const footerTerms = () =>
      page.evaluate(() =>
        document.querySelector("[data-legal-link='terms']")?.textContent
          ?.trim() ?? ""
      );
    const searchLabel = () =>
      page.evaluate(() =>
        document.querySelector("[data-cy='adm-search']")?.textContent
          ?.trim() ?? ""
      );

    const profileRead = page.waitForResponse(
      (x) => new URL(x.url()).pathname.endsWith("/profile"),
      { timeout: 15_000 },
    ).catch(() => null);
    const res = await page.goto("/admin?lang=en");
    const html = (await res?.text()) ?? "";
    expect(
      html.includes(">Terms of Service</a>"),
      "the server painted the footer in English",
    );
    expect(
      !html.includes(">Términos de servicio</a>"),
      "no Spanish footer in the server's markup",
    );
    const prompt = page.locator("[data-cy='staff-name-prompt']");
    await prompt.waitFor({ timeout: 15_000 });
    await profileRead; // the mount read of the profile (language "es") landed
    await page.waitForTimeout(1_000);
    expect.eq(await footerTerms(), "Terms of Service", "footer after load");
    expect.eq(await searchLabel(), "Search", "body after load");

    const input = page.locator("[data-cy='staff-name-input'][data-ready]");
    await input.waitFor({ timeout: 15_000 });
    await input.fill("Rafa Staff");
    await page.locator("[data-cy='staff-name-save']").click();
    await prompt.waitFor({ state: "detached", timeout: 15_000 });
    await page.waitForTimeout(1_500); // PROFILE_UPDATED → refreshDash lands
    expect.eq(await footerTerms(), "Terms of Service", "footer after save");
    expect.eq(await searchLabel(), "Search", "body after save");
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "<html lang> after save",
    );
  }));
