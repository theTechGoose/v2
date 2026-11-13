/**
 * REQ-731 — "fix every issue the demo found, loop until there are none." Demo-loop cycle 5,
 * issue m30 ("Owner can revoke their own admin").
 *
 * In a browser: on /admin the signed-in super admin's own row shows Revoke disabled, with a
 * tooltip saying why; and the API refuses a self revoke with 409 — the admin stays an admin.
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

async function superAdmin(
  http: StoryTools["http"],
  expect: StoryTools["expect"],
) {
  const phone = `+1843${digits()}`;
  const admin = await verify(http, phone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: "en", name: "Hans" }),
  })).body?.cancel();
  const token = Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN") ?? "";
  const boot = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, token }),
  });
  expect.eq(boot.status, 200, `bootstrap super admin (${await boot.text()})`);
  return admin;
}

Deno.test("REQ-731 m30: /admin disables Revoke on your own row; the API refuses a self revoke and you stay admin", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const admin = await superAdmin(http, expect);
    const me = admin.body.userId as string;
    await useCookie(page.context(), baseUrl, admin.cookie);

    const r = await http(`/api/admin/users/${me}/revoke`, {
      method: "POST",
      headers: admin.auth,
    });
    const text = await r.text();
    expect.eq(r.status, 409, `self revoke refused (${text})`);
    expect.eq(text.includes("cannot_revoke_self"), true, "names the reason");

    await page.goto("/admin");
    await page.locator("[data-cy='adm-q']").fill("Hans");
    await page.locator("[data-cy='adm-search']").click();
    const own = page.locator(`[data-cy='adm-toggle-super'][data-user='${me}']`);
    await own.waitFor({ timeout: 15_000 });
    expect.eq(await own.isDisabled(), true, "own Revoke is disabled");
    expect.eq(
      ((await own.getAttribute("title")) ?? "").length > 0,
      true,
      "own Revoke explains why",
    );
    const who = await http("/api/admin/whoami", { headers: admin.auth });
    const whoBody = await who.json();
    expect.eq(
      whoBody.superAdmin,
      true,
      `still a super admin (${JSON.stringify(whoBody)})`,
    );
  }));
