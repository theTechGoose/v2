/**
 * REQ-273 — demo issue i18n-formatting-m10: on /assistant the live-activity
 * pill read only "● hace 1m" — no event text, and an event seconds old said
 * "1m". In a real browser at the demo's desktop width the pill shows the
 * event's words in a track wide enough to read, a fresh event says "just now",
 * and on a phone the pill is hidden (as on the dashboard).
 *
 * The feed is answered by a page route (one event, created seconds ago) so the
 * story does not depend on which domain events a fresh account has produced;
 * the island's own 10 s poll is what picks it up.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

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
    body: JSON.stringify({ language: "en", name: "Ticker Story" }),
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

const EVENT = "Ana Ruiz accepted quote Q-1042";

Deno.test("REQ-273: /assistant's live-activity pill shows the event's text and 'just now' for a fresh event at desktop width, and is hidden on a phone", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Ticker Story" });

    await page.route("**/api/notifications?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          id: "n-ticker-1",
          userId: "u",
          type: "quote_accepted",
          title: `<strong>Ana Ruiz</strong> accepted quote Q-1042`,
          read: false,
          createdAt: new Date(Date.now() - 5_000).toISOString(),
        }]),
      }));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/assistant");
    // The pill appears once the island's poll has the event (≤ 10 s).
    await page.locator(".topbar__ticker-time").first().waitFor({
      state: "visible",
      timeout: 25_000,
    });
    const track = await page.locator(".topbar__ticker-track").first()
      .boundingBox();
    expect(
      (track?.width ?? 0) >= 100,
      `the text track is wide enough to read (${track?.width}px)`,
    );
    const item = page.locator(".topbar__ticker .topbar__ticker-item").first();
    expect(await item.isVisible(), "the event's text is visible in the pill");
    const text = await item.innerText();
    expect(
      text.replace(/\s+/g, " ").includes(EVENT),
      `the pill carries the event's words (${text})`,
    );
    const time = await page.locator(".topbar__ticker-time").first()
      .innerText();
    expect.eq(time.trim(), "just now", "a 5-second-old event is 'just now'");

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      !(await page.locator(".topbar__ticker").first().isVisible()),
      "the pill is hidden on a phone, as on the dashboard",
    );
  }));
