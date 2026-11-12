/**
 * REQ-355 — demo cycle 1, issues m1 + setup-m8: a staff member who never set a name was greeted
 * "Hey, Nuevo 👋" on /admin, was never asked for a name, and the greeting stayed stale after a
 * rename. Now: the placeholder is never shown as a name, a super admin on the placeholder is asked
 * "What's your name?", and saving it re-greets the topbar at once — no reload.
 * Run with SUPERADMIN_BOOTSTRAP_TOKEN set (shots' serve is stamped DENO_DEPLOY=true).
 */
import { story } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

Deno.test("REQ-355: a super admin still on 'Nuevo usuario' is never greeted as 'Nuevo', is asked for a name on /admin, and the topbar greets the saved name without a reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const phone = `+1512${digits()}`;
    // sign in WITHOUT a name: the account carries the seeded placeholder
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
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "en" }),
    })).body?.cancel();
    const me = await (await http("/api/me", { headers: auth })).json();
    expect(
      me.name === "Nuevo usuario" || me.name === "New user",
      `precondition: the placeholder name (${me.name})`,
    );
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
    await page.context().addCookies([...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]));

    await page.goto("/admin");
    const greet = page.locator(".topbar__greet-name");
    await greet.waitFor({ timeout: 15_000 });
    const before = (await greet.textContent()) ?? "";
    expect(
      !/Nuevo|New\b/.test(before),
      `the greeting never names the placeholder (${before})`,
    );
    const prompt = page.locator("[data-cy='staff-name-prompt']");
    await prompt.waitFor({ timeout: 15_000 });
    expect(
      ((await prompt.textContent()) ?? "").includes("What's your name?"),
      "the prompt asks for a name",
    );
    await page.evaluate(() => {
      (globalThis as unknown as { __noReload: boolean }).__noReload = true;
    });
    const input = page.locator("[data-cy='staff-name-input'][data-ready]");
    await input.waitFor({ timeout: 15_000 });
    await input.fill("Rafa Staff");
    await page.locator("[data-cy='staff-name-save']").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".topbar__greet-name")?.textContent?.includes(
          "Hey, Rafa",
        ) === true,
      undefined,
      { timeout: 15_000 },
    );
    expect.eq(
      await page.evaluate(() =>
        (globalThis as unknown as { __noReload?: boolean }).__noReload === true
      ),
      true,
      "the greeting changed without a reload",
    );
    await prompt.waitFor({ state: "detached", timeout: 15_000 });
    const saved = await (await http("/api/me", { headers: auth })).json();
    expect.eq(saved.name, "Rafa Staff", "the name is on record");

    await page.reload();
    await greet.waitFor({ timeout: 15_000 });
    expect(
      ((await greet.textContent()) ?? "").includes("Hey, Rafa"),
      "after a reload the server greets the saved name",
    );
    expect.eq(
      await page.locator("[data-cy='staff-name-prompt']").count(),
      0,
      "a named staff member is not asked again",
    );
  }));
