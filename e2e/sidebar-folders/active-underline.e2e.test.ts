/**
 * REQ-359 (demo-loop cycle 1, demo issue p15-4) — on the real shell, /customers highlights the
 * Customers row, and no sidebar link (root rows, "My assistant", "Worker view") is underlined —
 * on a dashboard.css page and on /assistant (assistant-page.css).
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

Deno.test("REQ-359: /customers highlights Customers; no sidebar link is underlined on /customers or /assistant (demo p15-4)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const user = await verify(http, `+1512${digits()}`);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "es", name: "Ana Torres" }),
    })).body?.cancel();
    const [name, value] = user.cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies([...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]));
    const underlined = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(
          ".sb a.nav-item, .sb a.sb__textus",
        )]
          .filter((a) => getComputedStyle(a).textDecorationLine !== "none")
          .map((a) => a.getAttribute("href") ?? "?")
      );

    await page.goto("/customers");
    const nav = page.locator(".sb__nav");
    await nav.locator("[data-cy='nav-folder-billing']").waitFor({
      timeout: 20_000,
    });
    await page.locator("a.nav-item[href='/customers']").waitFor({
      timeout: 20_000,
    });
    expect.eq(
      await nav.locator("a.nav-item--active").count(),
      1,
      "exactly one active row on /customers",
    );
    expect.eq(
      await nav.locator("a.nav-item--active[href='/customers']").count(),
      1,
      "the Customers row is the active one",
    );
    let lines = await underlined();
    expect(
      lines.length === 0,
      `no underlined sidebar link on /customers (got ${lines.join(", ")})`,
    );
    expect(
      (await page.locator(".sb a.nav-item, .sb a.sb__textus").count()) >= 3,
      "the scan saw the sidebar's links",
    );

    await page.goto("/assistant");
    await page.locator(".sb a.sb__textus").waitFor({ timeout: 20_000 });
    lines = await underlined();
    expect(
      lines.length === 0,
      `no underlined sidebar link on /assistant (got ${lines.join(", ")})`,
    );
  }));
