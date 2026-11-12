/**
 * REQ-255 (demo issue onboarding-dashboard-settings-m3a) — a business whose
 * address is in Texas and that never picked a time zone sees Central time on
 * Settings, not New York; a pick still wins.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
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
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Timezone Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

const SELECT = "[data-cy='settings-timezone']";

Deno.test("REQ-255: a Texas address with no zone picked shows America/Chicago on Settings; a pick is saved and wins", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const addr = await http("/api/profile/address", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        street: "1600 Congress Ave",
        city: "Austin",
        state: "TX",
        postal: "78701",
        country: "US",
      }),
    });
    expect.eq(addr.status, 200, "the address saves");
    await addr.body?.cancel();

    await page.goto("/settings");
    await page.locator(SELECT).waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator(SELECT).inputValue(),
      "America/Chicago",
      "Austin, TX reads Central time, not New York",
    );

    // a pick is stored and wins over the state
    for (let i = 0; i < 25; i++) {
      await page.locator(SELECT).selectOption("America/Denver").catch(() => {});
      const id = await (await http("/api/profile/identity", { headers: auth }))
        .json();
      if (id?.timezone === "America/Denver") break;
      await page.waitForTimeout(200);
    }
    const saved = await (await http("/api/profile/identity", { headers: auth }))
      .json();
    expect.eq(saved?.timezone, "America/Denver", "the pick is saved");
    await page.reload();
    await page.locator(SELECT).waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator(SELECT).inputValue(),
      "America/Denver",
      "the picked zone shows after a reload",
    );
  }));
