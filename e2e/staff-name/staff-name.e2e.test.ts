/**
 * REQ-355 — demo cycle 1, issues m1 + setup-m8: a staff member who never set a name was greeted
 * "Hey, Nuevo 👋" on /admin, was never asked for a name, and the greeting stayed stale after a
 * rename. Now: the placeholder is never shown as a name, a super admin on the placeholder is asked
 * "What's your name?", and saving it re-greets the topbar at once — no reload.
 * Run with SUPERADMIN_BOOTSTRAP_TOKEN set (shots' serve is stamped DENO_DEPLOY=true).
 */
import { story, type StoryTools } from "#shots";

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

/** REQ-423 — click until `done` holds (a click before hydration is a no-op: house clickUntil). */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
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

Deno.test("REQ-423: a fresh unnamed Spanish staff account reads 'Hola 👋' (never 'Hola, hola'), 'Hey 👋' after EN (never 'Hey, hola'), the sidebar never shows 'Nuevo usuario', and follows the saved name without a reload", (t) =>
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
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "es" }),
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
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]));

    await page.goto("/admin");
    const greet = page.locator(".topbar__greet-name");
    await greet.waitFor({ timeout: 15_000 });
    const es = ((await greet.textContent()) ?? "").trim();
    expect.eq(es, "Hola 👋", "ES: the nameless greeting");
    const footer = page.locator(".sb__footer");
    await footer.waitFor({ timeout: 15_000 });
    const sbEs = (await footer.textContent()) ?? "";
    expect(
      !/Nuevo usuario|New user/.test(sbEs),
      `ES: the sidebar never shows the placeholder (${sbEs})`,
    );
    expect(
      ((await footer.locator("[aria-hidden='true']").first().textContent()) ??
        "").trim() !== "NU",
      "ES: no 'NU' initials for the placeholder",
    );

    await page.evaluate(() => {
      (globalThis as unknown as { __noReload: boolean }).__noReload = true;
    });
    await clickUntil(
      page,
      "[data-cy='topbar-lang-en']",
      async () =>
        (await page.evaluate(() => document.documentElement.lang)) === "en",
    );
    const en = ((await greet.textContent()) ?? "").trim();
    expect.eq(en, "Hey 👋", "EN: the nameless greeting (never 'Hey, hola')");
    const sbEn = (await footer.textContent()) ?? "";
    expect(
      !/Nuevo usuario|New user/.test(sbEn),
      `EN: the sidebar never shows the placeholder (${sbEn})`,
    );

    const input = page.locator("[data-cy='staff-name-input'][data-ready]");
    await input.waitFor({ timeout: 15_000 });
    await input.fill("Rafa Staff");
    await page.locator("[data-cy='staff-name-save']").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".sb__footer")?.textContent?.includes(
          "Rafa Staff",
        ) === true,
      undefined,
      { timeout: 15_000 },
    );
    expect(
      ((await greet.textContent()) ?? "").includes("Hey, Rafa"),
      "the topbar greets the saved name",
    );
    expect.eq(
      await page.evaluate(() =>
        (globalThis as unknown as { __noReload?: boolean }).__noReload === true
      ),
      true,
      "the sidebar followed the save without a reload",
    );
  }));

Deno.test("REQ-606 (demo cycle 4, m20): after the staff name prompt saves, the admin's own /admin row shows the name at once — no '(no name yet)' waiting on a refresh that a locked or backed-off page never makes", (t) =>
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
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "en" }),
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
    await page.context().addCookies([...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]));

    // narrow the list to this admin's own row
    await page.goto(`/admin`);
    const q = page.locator("[data-cy='adm-q']");
    await q.waitFor({ timeout: 15_000 });
    const self = page.locator("[data-cy='adm-name']");
    await clickUntil(page, "[data-cy='adm-search']", async () => {
      if ((await q.inputValue()) !== phone.slice(2)) {
        await q.fill(phone.slice(2));
      }
      return (await self.count()) === 1;
    });
    expect.eq(
      ((await self.first().textContent()) ?? "").trim(),
      "(no name yet)",
      "precondition: the placeholder row",
    );

    // from here the users list is never re-read — as on a locked page (a Demo made this
    // browser the customer) or an idle one backed off to 60 s (REQ-424)
    let reads = 0;
    await page.route("**/admin/users?**", (route) => {
      reads++;
      return route.abort();
    });

    const input = page.locator("[data-cy='staff-name-input'][data-ready]");
    await input.waitFor({ timeout: 15_000 });
    await input.fill("Rafa Staff");
    await page.locator("[data-cy='staff-name-save']").click();
    await page.locator("[data-cy='staff-name-prompt']").waitFor({
      state: "detached",
      timeout: 15_000,
    });
    try {
      await page.waitForFunction(
        () =>
          document.querySelector("[data-cy='adm-name']")?.textContent
            ?.trim() === "Rafa Staff",
        undefined,
        { timeout: 5_000 },
      );
    } catch {
      throw new Error(
        `the admin's own row still reads "${
          ((await self.first().textContent()) ?? "").trim()
        }" after the name was saved (users-list reads since: ${reads})`,
      );
    }
    const opt = await page.locator("#impersonate-select option")
      .allTextContents();
    expect(
      opt.some((o) => o.startsWith("Rafa Staff")),
      `the Impersonate list follows too (${opt.join(" | ")})`,
    );
  }));
