/**
 * REQ-726 — demo-loop cycle 5 (run r37f88707), issues m6 and m57.
 *
 * m6 "Toasts/top-bar notice stay for minutes and squeeze the search box": the
 * live-activity pill showed the newest event forever ("Pago registrado …
 * hace 4m" on every page) and shared the search row at 1280/1440 px, cutting
 * the search placeholder. Now: hidden below 1500 px, and an event older than
 * ~90 s is not shown at all; where it shows, its time sits on one line.
 *
 * m57 "Activity toast link doesn't scroll to Activity": /dashboard#activity
 * stayed at the top under the coach mark — the SSR skeleton has no #activity,
 * so the browser's fragment scroll found nothing. Now the island scrolls to
 * the panel once it mounts, and the coach mark stays away on that arrival.
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
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  await answerQuestions(http, { ...JSON_HEADERS, cookie }, {
    name: "Ticker Expiry",
  });
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
}

/** The feed answers one payment event `ageMs` old. */
async function feedOneEvent(page: StoryTools["page"], ageMs: number) {
  await page.unroute("**/api/notifications?*").catch(() => {});
  await page.route("**/api/notifications?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: `n-expiry-${ageMs}`,
        userId: "u",
        type: "payment_recorded",
        title: "Pago registrado: $180 de <strong>María López</strong>",
        read: false,
        createdAt: new Date(Date.now() - ageMs).toISOString(),
      }]),
    }));
}

Deno.test("REQ-726 m6 (demo cycle 5): the activity pill is hidden at 1280/1440 px, shows a fresh event on one line from 1500 px, and never shows a 4-minute-old one", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);

    await feedOneEvent(page, 5_000);
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard");
      await page.locator(".topbar__ticker").first().waitFor({
        state: "attached",
        timeout: 25_000,
      });
      const m = await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>(
          ".topbar__search input",
        )!;
        const cs = getComputedStyle(input);
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.font =
          `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        return {
          pill: getComputedStyle(document.querySelector(".topbar__ticker")!)
            .display,
          need: Math.ceil(ctx.measureText(input.placeholder).width),
          have: input.clientWidth,
        };
      });
      expect.eq(
        m.pill,
        "none",
        `${width}px: the pill is out of the search row`,
      );
      expect(
        m.have >= m.need,
        `${width}px: the search shows its whole placeholder (${m.have}px for ${m.need}px)`,
      );
    }

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/dashboard");
    const time = page.locator(".topbar__ticker-time").first();
    await time.waitFor({ state: "visible", timeout: 25_000 });
    const lines = await time.evaluate((el) =>
      Math.round(
        el.getBoundingClientRect().height /
          parseFloat(getComputedStyle(el).lineHeight),
      )
    );
    expect.eq(lines, 1, "1600px: the pill's time sits on one line");

    await feedOneEvent(page, 4 * 60_000);
    await page.goto("/dashboard");
    await page.locator("#activity").waitFor({ timeout: 25_000 });
    await page.waitForTimeout(1_500);
    expect.eq(
      await page.locator(".topbar__ticker").count(),
      0,
      "a 4-minute-old event is not shown in the bar (the Activity panel keeps it)",
    );
  }));

Deno.test("REQ-726 m57 (demo cycle 5): /dashboard#activity lands on the Activity panel, with no coach mark over it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1440, height: 640 });
    // Cold start (no dash cache) and warm start (arriving from another page).
    for (const from of [null, "/customers"]) {
      if (from) {
        await page.goto(from);
        await page.waitForLoadState("load");
      }
      await page.goto("/dashboard#activity");
      const panel = page.locator("#activity");
      await panel.waitFor({ timeout: 25_000 });
      await page.waitForTimeout(1_200);
      // The app shell scrolls inside `.content`, not the window.
      const m = await page.evaluate(() => {
        const el = document.getElementById("activity")!;
        const box = document.querySelector<HTMLElement>(".content")!;
        const docTop = el.getBoundingClientRect().top -
          box.getBoundingClientRect().top + box.scrollTop;
        return {
          y: box.scrollTop,
          want: Math.min(docTop, box.scrollHeight - box.clientHeight),
          top: el.getBoundingClientRect().top,
          vh: globalThis.innerHeight,
        };
      });
      const where = from ? `from ${from}` : "cold";
      expect(
        m.want > 0,
        `${where}: the panel starts below the fold (doc top ${m.want})`,
      );
      expect(
        Math.abs(m.y - m.want) <= 4 && m.top < m.vh,
        `${where}: the page scrolled to #activity (scrollY ${m.y}, want ${m.want}, panel top ${m.top})`,
      );
      expect.eq(
        await page.locator("[role='dialog'][aria-label]").count(),
        0,
        `${where}: no coach mark veils the Activity panel`,
      );
    }
  }));
