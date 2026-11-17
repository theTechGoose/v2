/**
 * REQ-422 — demo-loop cycle 2, issue m48: "First EN click on the first dashboard visit is ignored
 * (two PUT /api/me)". The authed pages' islands call refreshDash() on mount; its profile + stats
 * read can still be in flight when the contractor clicks EN in the topbar. When that read lands
 * after the click, its `user.language` (still "es") used to be applied over the choice, so the UI
 * flipped back to Spanish and a second click (a second PUT /api/me) was needed. Here the stats
 * read is held open in the browser until after the click, which pins the race open on purpose.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
type Page = StoryTools["page"];

async function signInSpanish(
  http: StoryTools["http"],
  page: Page,
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es", name: "Lena Lang Race" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  return { auth };
}

const htmlLang = (page: Page) =>
  page.evaluate(() => document.documentElement.lang);

Deno.test("REQ-422 (demo m48): one EN click holds even when the page's first profile/stats read lands after it — one PUT /api/me", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signInSpanish(http, page, baseUrl);

    // Hold the dashboard stats read open until after the click.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let statsHeld = 0;
    await page.route("**/api/analytics/dashboard**", async (route) => {
      statsHeld++;
      await gate;
      await route.continue();
    });
    let putMe = 0;
    page.on("request", (req) => {
      if (req.method() === "PUT" && new URL(req.url()).pathname === "/api/me") {
        putMe++;
      }
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/customers");
    const en = page.locator("[data-cy='topbar-lang-en']");
    await en.waitFor({ timeout: 20_000 });
    // the islands' refreshDash() is in flight (its stats read is held)
    for (let i = 0; i < 100 && statsHeld === 0; i++) {
      await page.waitForTimeout(100);
    }
    expect(statsHeld > 0, "the page started its dashboard read");
    expect.eq(await htmlLang(page), "es", "served in Spanish");

    // ONE click on EN (retried only while the island is not yet hydrated).
    for (let i = 0; i < 50 && (await htmlLang(page)) !== "en"; i++) {
      if (putMe === 0) await en.click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
    expect.eq(await htmlLang(page), "en", "the click flipped to EN");

    // Let the stale read land, then give it time to (not) revert anything.
    const statsDone = page.waitForResponse(
      (r) => r.url().includes("/api/analytics/dashboard"),
      { timeout: 20_000 },
    );
    release();
    await statsDone;
    await page.waitForTimeout(1_500);

    expect.eq(await htmlLang(page), "en", "still EN after the stale read");
    expect.eq(
      await en.getAttribute("aria-pressed"),
      "true",
      "the EN button stays pressed",
    );
    expect.eq(putMe, 1, "exactly one PUT /api/me");
    const me = await http("/api/profile", { headers: auth });
    const snap = await me.json();
    expect.eq(snap?.user?.language, "en", "the server saved EN");
  }));
