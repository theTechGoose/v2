/**
 * REQ-604 (demo-loop cycle 4, issue m18) — on the real shell: the Field folder lists Workers
 * (customers looked for it there), and a super-admin sees the Admin tab on the sidebar root
 * without opening the Roles folder.
 *
 * Run with SUPERADMIN_BOOTSTRAP_TOKEN set when the serve is a real deploy.
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
  return { cookie, auth: { ...JSON_HEADERS, cookie } };
}

Deno.test("REQ-604 m18: Field lists Workers; a super-admin sees Admin on the sidebar root, and /admin rests there", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const phone = `+1843${digits()}`;
    const user = await verify(http, phone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Hans" }),
    })).body?.cancel();
    const token = Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN") ?? "";
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, token }),
    });
    expect.eq(boot.status, 200, `bootstrap super admin (${await boot.text()})`);
    const [name, value] = user.cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies([...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]));
    const nav = page.locator(".sb__nav");
    const labels = async () =>
      (await nav.locator(".nav-item__label").allInnerTexts()).map((s) =>
        s.trim()
      );

    // 1. the root carries Admin for a super-admin — no folder to open first
    await page.goto("/customers");
    await nav.locator("a[href='/admin']").waitFor({ timeout: 20_000 });
    expect(
      (await nav.locator("[data-cy='nav-back']").count()) === 0,
      "Admin is on the root, not behind a folder",
    );

    // 2. Field lists Workers next to the field pages
    await nav.locator("[data-cy='nav-folder-field']").click();
    await nav.locator("a[href='/field/batches']").waitFor({ timeout: 10_000 });
    const seen = await labels();
    expect(
      seen.includes("Workers"),
      `Field lists Workers (${seen.join(", ")})`,
    );

    // 3. /admin loads with the sidebar on the root and Admin active
    await page.goto("/admin");
    await nav.locator("a[href='/admin'].nav-item--active").waitFor({
      timeout: 20_000,
    });
    expect(
      (await nav.locator("[data-cy='nav-folder-billing']").count()) === 1,
      "on /admin the sidebar rests on the root",
    );
  }));
