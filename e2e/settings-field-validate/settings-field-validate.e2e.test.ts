/**
 * REQ-501 (demo-loop cycle 3, M35) — "fix every issue the demo found, loop until there are
 * none". The demo typed "carl@@jensen" into Settings → Email and cleared the business name; both
 * saved on blur (PUT 200), the hero went blank and the initials changed CJ → CA. In a browser:
 * each blur now shows an inline error under its field, nothing is saved, and the hero keeps the
 * business name.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      language: "en",
      name: "Carl Jensen",
      email: "carl@jensen.com",
    }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Jensen Roofing" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

/** Type a value and leave the field until `done` holds — input before hydration is a no-op. */
async function fillAndBlurUntil(
  page: StoryTools["page"],
  selector: string,
  value: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await page.locator(selector).fill(value, { timeout: 2_000 });
      await page.locator(selector).press("Tab", { timeout: 2_000 });
    } catch {
      // not editable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the blur never took`);
}

const visible = (page: StoryTools["page"], selector: string) => () =>
  page.locator(selector).isVisible().catch(() => false);

Deno.test("REQ-501 M35: Settings refuses 'carl@@jensen' and a blank business name on blur — inline errors, nothing saved, hero keeps the name", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.goto("/settings");
    await page.locator("[data-cy='settings-email']").waitFor({
      timeout: 20_000,
    });

    await fillAndBlurUntil(
      page,
      "[data-cy='settings-email']",
      "carl@@jensen",
      visible(page, "[data-cy='settings-email-error']"),
    );
    expect.eq(
      await page.locator("[data-cy='settings-email-error']").innerText(),
      "Enter a valid email address, like name@example.com.",
      "email inline error",
    );

    await fillAndBlurUntil(
      page,
      "[data-cy='settings-biz']",
      "",
      visible(page, "[data-cy='settings-biz-error']"),
    );
    expect.eq(
      await page.locator("[data-cy='settings-biz-error']").innerText(),
      "Type a name — spaces alone don't count.",
      "business name inline error",
    );

    // nothing reached the server
    await page.waitForTimeout(500);
    const me = await (await http("/api/me", { headers: auth })).json();
    expect.eq(me.email, "carl@jensen.com", "stored email unchanged");
    const id = await (await http("/api/profile/identity", { headers: auth }))
      .json();
    expect.eq(id.businessName, "Jensen Roofing", "stored business unchanged");
    expect.eq(
      (await page.locator(".hero__title").innerText()).trim(),
      "Jensen Roofing",
      "hero keeps the business name",
    );

    // a good value clears the error and saves
    await fillAndBlurUntil(
      page,
      "[data-cy='settings-email']",
      "carl@jensenroofing.com",
      async () =>
        !(await visible(page, "[data-cy='settings-email-error']")()) &&
        (await (await http("/api/me", { headers: auth })).json()).email ===
          "carl@jensenroofing.com",
    );
  }));
