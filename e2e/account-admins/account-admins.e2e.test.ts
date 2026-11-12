/**
 * REQ-146 — account admins, end to end on the real shell: the owner invites a
 * phone number on /admins; that number signs in on its own (the dev code) and
 * the session opens IN the owner's account — /customers shows the owner's
 * customer and the sidebar says whose account this is; the owner then removes
 * the admin and the admin's next page load is bounced to the login.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** a phone's OTP sign-in through the proxy (the dev code), as the login page does */
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

/** the browser takes this session (and English) — the previous one is dropped */
async function useCookie(
  page: StoryTools["page"],
  baseUrl: string,
  cookie: string,
) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().clearCookies();
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
}

Deno.test("REQ-146: the owner invites a number on /admins; that number signs in and sees the owner's customer on /customers and the owner's business in the sidebar; the owner removes the admin and the admin is out", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const ownerPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const owner = await verify(http, ownerPhone);
    const me = await http("/api/me", {
      method: "PUT",
      headers: owner.auth,
      body: JSON.stringify({ language: "en", name: "Raphael Castro" }),
    });
    await me.body?.cancel();
    const biz = await http("/api/profile/identity", {
      method: "PUT",
      headers: owner.auth,
      body: JSON.stringify({ businessName: "Monster RG" }),
    });
    await biz.body?.cancel();
    const c = await http("/api/customers", {
      method: "POST",
      headers: owner.auth,
      body: JSON.stringify({ name: "Ana Torres" }),
    });
    expect(
      c.status === 201 || c.status === 200,
      `customer created (${c.status})`,
    );
    await c.body?.cancel();
    await useCookie(page, baseUrl, owner.cookie);

    // 1. the owner invites the number on /admins
    await page.goto("/admins");
    await page.locator("[data-cy='adm-phone']").fill(adminPhone.slice(2));
    await page.locator("[data-cy='adm-name']").fill("Hans");
    await page.locator("[data-cy='adm-invite']").click();
    await page.locator("[data-cy='adm-row']").first().waitFor({
      timeout: 15_000,
    });
    await expect.see("Hans");
    await expect.see(
      `(${adminPhone.slice(2, 5)}) ${adminPhone.slice(5, 8)}-${
        adminPhone.slice(8)
      }`,
    );
    const row = page.locator("[data-cy='adm-row']").first();
    const adminId = await row.getAttribute("data-id");
    expect(!!adminId, "the row carries the admin's id");

    // 2. the number signs in on its own — the session opens in the owner's account
    const admin = await verify(http, adminPhone);
    expect.eq(admin.body.isNewUser, false, "an admin is not a sign-up");
    const who = await http("/api/me", { headers: admin.auth });
    const whoBody = await who.json();
    expect.eq(
      whoBody.id,
      owner.body.userId,
      "the admin's session is the owner's account",
    );
    await useCookie(page, baseUrl, admin.cookie);
    await page.goto("/customers");
    await page.locator(".ccard2", { hasText: "Ana Torres" }).waitFor({
      timeout: 20_000,
    });
    await expect.see("Ana Torres");
    await page.locator("[data-cy='acting-in']").waitFor({ timeout: 15_000 });
    await expect.see("Monster RG");
    const options = page.locator("[data-cy='account-switch'] option");
    await options.nth(1).waitFor({ state: "attached", timeout: 10_000 });
    expect.eq(
      await options.count(),
      2,
      "the switcher lists the admin's own account and Monster RG",
    );
    // the owner-only surface is refused to the admin
    const wipe = await http("/api/me/wipe", { headers: admin.auth });
    expect.eq(wipe.status, 403, "an admin cannot wipe the owner's account");
    await wipe.body?.cancel();
    await page.goto("/admins");
    await page.locator("[data-cy='adm-row']").first().waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='adm-form']").count(),
      0,
      "an admin sees the list, not the invite form",
    );

    // 3. the owner removes the admin; the admin's session is cut at once
    await useCookie(page, baseUrl, owner.cookie);
    await page.goto("/admins");
    await page.locator("[data-cy='adm-row']").first().waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='adm-remove']").first().click();
    await page.locator("[data-cy='adm-remove-confirm']").first().click();
    await page.locator("[data-cy='adm-empty']").waitFor({ timeout: 15_000 });
    const cut = await http("/api/me", { headers: admin.auth });
    expect.eq(cut.status, 401, "the admin's session is gone");
    await cut.body?.cancel();
  }));

Deno.test("REQ-632: the editor's name is required — Invite stays disabled until it is filled, leaving it empty shows the error in English and in Spanish, and the API refuses a nameless invite with name_required", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const owner = await verify(http, `+1512${digits()}`);
    const me = await http("/api/me", {
      method: "PUT",
      headers: owner.auth,
      body: JSON.stringify({ language: "en", name: "Alexander Jerez" }),
    });
    await me.body?.cancel();
    const herPhone = `+1843${digits()}`;

    // the API: missing, blank, whitespace and the placeholder are each a 400 name_required
    for (const name of [undefined, "", "   ", "New user"]) {
      const r = await http("/api/me/admins", {
        method: "POST",
        headers: owner.auth,
        body: JSON.stringify({ phoneNumber: herPhone.slice(2), ...(name === undefined ? {} : { name }) }),
      });
      expect.eq(r.status, 400, `refused: ${JSON.stringify(name)}`);
      expect.eq((await r.json()).error, "name_required", `the code: ${JSON.stringify(name)}`);
    }

    // the form, in English
    await useCookie(page, baseUrl, owner.cookie);
    await page.goto("/admins");
    const invite = page.locator("[data-cy='adm-invite']");
    const name = page.locator("[data-cy='adm-name']");
    const err = page.locator("[data-cy='adm-name-error']");
    await invite.waitFor({ timeout: 15_000 });
    expect.eq(await name.getAttribute("required"), "", "the name field is required");
    await page.locator("[data-cy='adm-phone']").fill(herPhone.slice(2));
    expect(await invite.isDisabled(), "a phone alone does not enable Invite");
    await name.focus();
    await name.blur();
    await err.waitFor({ timeout: 10_000 });
    await expect.see("Enter the editor's name");
    expect.eq(await name.getAttribute("aria-invalid"), "true", "the field says it is invalid");
    await name.fill("   ");
    expect(await invite.isDisabled(), "spaces are no name");
    await name.fill("Sofia Jerez");
    await err.waitFor({ state: "detached", timeout: 10_000 });
    expect(!(await invite.isDisabled()), "a name and a phone enable Invite");
    await invite.click();
    await page.locator("[data-cy='adm-row']", { hasText: "Sofia Jerez" }).waitFor({ timeout: 15_000 });

    // and in Spanish
    await page.locator("[data-cy='topbar-lang-es']").click();
    await page.locator("[data-cy='adm-phone']").fill(`843${digits()}`);
    await name.focus();
    await name.blur();
    await err.waitFor({ timeout: 10_000 });
    await expect.see("Escribe el nombre del editor");
    expect(await invite.isDisabled(), "still disabled in Spanish");
  }));
