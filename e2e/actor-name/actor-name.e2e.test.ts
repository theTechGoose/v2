/**
 * REQ-624 — "When his daughter logs in she still sees Alexander's name." On the real shell: the
 * owner invites an editor named "Daughter Test" on /admins; she signs in and the greeting and the
 * sidebar name HER while the business shown is still the owner's; she edits her name on Settings
 * and the owner's name is untouched. An editor invited with no name is asked hers once.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  return { body, cookie, auth: { ...JSON_HEADERS, cookie } };
}

/** the browser takes this session (and English) — the previous one is dropped */
async function useCookie(page: StoryTools["page"], baseUrl: string, cookie: string) {
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

/** an owner past onboarding (REQ-091 gates /dashboard on it), named, with a business */
async function owner(http: StoryTools["http"]) {
  const o = await verify(http, `+1512${digits()}`);
  const lang = await http("/api/me", { method: "PUT", headers: o.auth, body: JSON.stringify({ language: "en" }) });
  await lang.body?.cancel();
  await answerQuestions(http, o.auth, { name: "Alexander Jerez", businessName: "A2Z Landscape LLC" });
  return o;
}

Deno.test("REQ-624: the owner invites \"Daughter Test\"; she signs in and the greeting and the sidebar name her, the business is the owner's; her Settings name edit leaves the owner's name alone", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const o = await owner(http);
    const herPhone = `+1843${digits()}`;
    await useCookie(page, baseUrl, o.cookie);

    // 1. the owner invites her on /admins, name and all
    await page.goto("/admins");
    await page.locator("[data-cy='adm-phone']").fill(herPhone.slice(2));
    await page.locator("[data-cy='adm-name']").fill("Daughter Test");
    await page.locator("[data-cy='adm-invite']").click();
    await page.locator("[data-cy='adm-row']").first().waitFor({ timeout: 15_000 });

    // 2. she signs in — the account is the owner's, the name is hers
    const her = await verify(http, herPhone);
    await useCookie(page, baseUrl, her.cookie);
    await page.goto("/dashboard");
    const greet = page.locator("[data-cy='topbar-greeting']");
    await greet.waitFor({ timeout: 20_000 });
    const greeting = (await greet.textContent()) ?? "";
    expect(greeting.includes("Daughter"), `the greeting names her: "${greeting}"`);
    expect(!greeting.includes("Alexander"), `not the owner: "${greeting}"`);
    // the browser swapped cookies under the owner's tab (no sign-out), so the sidebar may open on
    // the owner's cached snapshot for a beat; the profile read then names her
    const userName = page.locator("[data-cy='sb-user-name']", { hasText: "Daughter Test" });
    await userName.waitFor({ timeout: 20_000 });
    expect.eq((await userName.textContent())?.trim(), "Daughter Test", "the sidebar user block is hers");
    expect.eq(
      (await page.locator("[data-cy='sb-user-biz']").textContent())?.trim(),
      "A2Z Landscape LLC",
      "the business shown is the owner's",
    );
    expect.eq((await page.locator("[data-cy='sb-user-initials']").textContent())?.trim(), "DT", "her initials");
    expect.eq(await page.locator("[data-cy='actor-name-prompt']").count(), 0, "a named editor is not asked");
    await expect.see("Daughter Test");

    // 3. Settings: "your name" is hers; editing it renames her, never the owner
    await page.goto("/settings");
    const nameField = page.locator("[data-cy='settings-name']");
    await nameField.waitFor({ timeout: 20_000 });
    expect.eq(await nameField.inputValue(), "Daughter Test", "Settings' name field is hers");
    expect.eq(
      (await page.locator("[data-cy='settings-phone']").textContent())?.trim(),
      `(${herPhone.slice(2, 5)}) ${herPhone.slice(5, 8)}-${herPhone.slice(8)}`,
      "and the number on the account card is hers",
    );
    await nameField.fill("Daughter Edited");
    await nameField.blur();
    let saved: string | undefined;
    for (let i = 0; i < 30 && saved !== "Daughter Edited"; i++) {
      await page.waitForTimeout(500);
      const r = await http("/api/me", { headers: her.auth });
      saved = (await r.json()).actor?.name;
    }
    expect.eq(saved, "Daughter Edited", "her name is saved to her");
    const ownerMe = await http("/api/me", { headers: o.auth });
    expect.eq((await ownerMe.json()).name, "Alexander Jerez", "the owner's name is unchanged");
    await page.goto("/dashboard");
    await page.locator("[data-cy='sb-user-name']", { hasText: "Daughter Edited" }).waitFor({ timeout: 20_000 });
  }));

Deno.test("REQ-624: an editor invited with no name is asked hers once; it is saved to her, never to the owner", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const o = await owner(http);
    const herPhone = `+1843${digits()}`;
    const inv = await http("/api/me/admins", {
      method: "POST",
      headers: o.auth,
      body: JSON.stringify({ phoneNumber: herPhone.slice(2) }),
    });
    expect.eq(inv.status, 201, "invited without a name");
    await inv.body?.cancel();

    const her = await verify(http, herPhone);
    await useCookie(page, baseUrl, her.cookie);
    await page.goto("/dashboard");
    const prompt = page.locator("[data-cy='actor-name-prompt']");
    await prompt.waitFor({ timeout: 20_000 });
    const greeting = (await page.locator("[data-cy='topbar-greeting']").textContent()) ?? "";
    expect(!greeting.includes("Alexander"), `never the owner's name: "${greeting}"`);
    await page.locator("[data-cy='actor-name-input']").fill("Sofia Jerez");
    await page.locator("[data-cy='actor-name-save']").click();
    await prompt.waitFor({ state: "detached", timeout: 15_000 });
    await page.locator("[data-cy='sb-user-name']", { hasText: "Sofia Jerez" }).waitFor({ timeout: 15_000 });
    const ownerMe = await http("/api/me", { headers: o.auth });
    expect.eq((await ownerMe.json()).name, "Alexander Jerez", "the owner is not renamed");
    await page.goto("/dashboard");
    await page.locator("[data-cy='sb-user-name']", { hasText: "Sofia Jerez" }).waitFor({ timeout: 20_000 });
    expect.eq(await prompt.count(), 0, "asked once — named now");
  }));
