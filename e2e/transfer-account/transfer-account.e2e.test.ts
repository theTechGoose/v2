/**
 * REQ-220 — "Transfer account", end to end in a browser: Settings shows the button next to the
 * phone; the dialog takes the new owner's number, then the code texted to it (shown on the fakes);
 * the account moves — this browser lands on /login, the new number signs in and sees the old
 * owner's customer, and the old number's sign-in is a brand-new, empty account.
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

const pretty = (e164: string) =>
  `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;

Deno.test("REQ-220: Settings → Transfer account next to the phone; the new number's code moves the account; this browser is signed out; the new number sees the old owner's customer and the old number starts empty", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const oldPhone = `+1512${digits()}`;
    const newPhone = `+1843${digits()}`;
    const owner = await verify(http, oldPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: owner.auth,
      body: JSON.stringify({ language: "en", name: "Old Owner" }),
    })).body?.cancel();
    await (await http("/api/profile/identity", {
      method: "PUT",
      headers: owner.auth,
      body: JSON.stringify({ businessName: "Acme Roofing" }),
    })).body?.cancel();
    await (await http("/api/customers", {
      method: "POST",
      headers: owner.auth,
      body: JSON.stringify({ name: "Ana Torres" }),
    })).body?.cancel();
    await useCookie(page, baseUrl, owner.cookie);

    // 1. the button sits on the phone row
    await page.goto("/settings");
    const open = page.locator("[data-cy='transfer-open']");
    await open.waitFor({ timeout: 20_000 });
    await expect.see(pretty(oldPhone));
    await expect.see("Transfer account");
    expect.eq(
      await page.locator("[data-cy='transfer-modal']").count(),
      0,
      "the dialog is closed until asked for",
    );

    // 2. the dialog: the owner's own number is refused, the new one gets a code
    const phoneInput = page.locator("[data-cy='transfer-phone']");
    for (let i = 0; i < 20 && !(await phoneInput.count()); i++) {
      await open.click(); // a click before hydration is lost — click until the dialog is there
      await page.waitForTimeout(250);
    }
    await phoneInput.fill(oldPhone.slice(2));
    await page.locator("[data-cy='transfer-send']").click();
    await page.locator("[data-cy='transfer-error']").waitFor({
      timeout: 10_000,
    });
    await expect.see("already the number on this account");
    await phoneInput.fill(newPhone.slice(2));
    await page.locator("[data-cy='transfer-send']").click();
    const dev = page.locator("[data-cy='transfer-dev-code']");
    await dev.waitFor({ timeout: 10_000 });
    await expect.see(pretty(newPhone));
    const code = ((await dev.textContent()) ?? "").match(/\d{6}/)?.[0] ?? "";
    expect(code.length === 6, `the fakes show the code (${code})`);

    // 3. a wrong code keeps the dialog; the right one moves the account and signs this browser out
    const wrong = code === "111111" ? "222222" : "111111";
    await page.locator("[data-cy='transfer-code']").fill(wrong);
    await page.locator("[data-cy='transfer-confirm']").click();
    await page.locator("[data-cy='transfer-error']").waitFor({
      timeout: 10_000,
    });
    await expect.see("That code is not right");
    await page.locator("[data-cy='transfer-code']").fill(code);
    await page.locator("[data-cy='transfer-confirm']").click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    const dead = await http("/api/me", { headers: owner.auth });
    expect.eq(dead.status, 401, "the old owner's session is gone");
    await dead.body?.cancel();

    // 4. the new number signs in — the same account, the old owner's customer, the new phone in settings
    const next = await verify(http, newPhone);
    expect.eq(next.body.userId, owner.body.userId, "the same account");
    expect.eq(next.body.isNewUser, false, "a transfer is not a sign-up");
    await useCookie(page, baseUrl, next.cookie);
    await page.goto("/customers");
    await page.locator(".ccard2", { hasText: "Ana Torres" }).waitFor({
      timeout: 20_000,
    });
    await page.goto("/settings");
    await page.locator("[data-cy='transfer-open']").waitFor({
      timeout: 20_000,
    });
    await expect.see(pretty(newPhone));
    await expect.see("Acme Roofing");

    // 5. the old number is free — its sign-in is a brand-new, empty account
    const again = await verify(http, oldPhone);
    expect(again.body.userId !== owner.body.userId, "a different account");
    const customers = await (await http("/api/customers", {
      headers: again.auth,
    })).json();
    expect.eq(
      (Array.isArray(customers) ? customers : customers.items ?? []).length,
      0,
      "the old number's new account has no customers",
    );
  }));
