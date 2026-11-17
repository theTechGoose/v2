/**
 * REQ-406 — demo-loop cycle 2, issues m15 and m47.
 *
 * m15: at a laptop width the live-activity pill ("… accepted your quote") took
 * up to 480 px of the topbar and squeezed the search box until its placeholder
 * read "Search a number, customer," — on /assistant (assistant-page.css) and
 * the dashboard routes (dashboard.css) alike. At 1280×720 the search input is
 * at least as wide as its own placeholder, and the pill never overlaps it.
 *
 * m47: on a phone the header with ☰ scrolled away — DashTopbar's inline
 * `position:relative` beat the phone rule's `position:sticky`. At 390 px the
 * topbar is sticky and stays at the top after the page scrolls.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
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
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: lang, name: "Topbar Story" }),
  });
  await me.body?.cancel();
  await answerQuestions(http, auth, { name: "Topbar Story" });
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
}

/** One long, fresh event — the sentence the demo saw beside the search box. */
async function feedOneLongEvent(page: StoryTools["page"]) {
  await page.route("**/api/notifications?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: "n-layout-1",
        userId: "u",
        type: "quote_accepted",
        title:
          `<strong>Cobblestone Cafe of South Austin</strong> accepted your quote Q-1042 for the kitchen remodel`,
        read: false,
        createdAt: new Date(Date.now() - 5_000).toISOString(),
      }]),
    }));
}

async function searchFitsItsPlaceholder(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
  where: string,
) {
  await page.locator(".topbar__ticker-time").first().waitFor({
    state: "visible",
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
    const r = (sel: string) =>
      document.querySelector(sel)!.getBoundingClientRect();
    const s = r(".topbar__search");
    const t = r(".topbar__ticker");
    return {
      placeholder: input.placeholder,
      need: Math.ceil(ctx.measureText(input.placeholder).width),
      have: input.clientWidth,
      overlap: Math.max(
        0,
        Math.min(s.right, t.right) - Math.max(s.left, t.left),
      ),
    };
  });
  expect(
    m.have >= m.need,
    `${where}: the search input shows its whole placeholder "${m.placeholder}" (${m.have}px for ${m.need}px)`,
  );
  expect.eq(m.overlap, 0, `${where}: the pill does not overlap the search box`);
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-406 (demo m15, cycle 2): at 1280×720 the live-activity pill never squeezes the search box below its placeholder (${lang}, /assistant and /dashboard)`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await signIn(http, page, baseUrl, lang);
      await feedOneLongEvent(page);
      // REQ-726 (cycle 5, m6): the pill is hidden below 1500px now, so the
      // squeeze is checked at the narrowest width it still shows.
      await page.setViewportSize({ width: 1500, height: 720 });
      for (const path of ["/assistant", "/dashboard"]) {
        await page.goto(path);
        await searchFitsItsPlaceholder(page, expect, `${path} (${lang})`);
      }
    }));
}

Deno.test("REQ-406 (demo m47, cycle 2): on a 390 px phone the header with ☰ is sticky and stays on screen after the page scrolls", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl, "en");
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/dashboard", "/quotes"]) {
      await page.goto(path);
      const bar = page.locator("header.topbar").first();
      await bar.waitFor({ state: "visible", timeout: 15_000 });
      expect.eq(
        await bar.evaluate((el) => getComputedStyle(el).position),
        "sticky",
        `${path}: the topbar is position:sticky on a phone`,
      );
      // Make sure the document can scroll, whatever a fresh account renders.
      await page.evaluate(() => {
        const pad = document.createElement("div");
        pad.style.height = "2400px";
        (document.querySelector(".content") ?? document.body).appendChild(pad);
        globalThis.scrollTo(0, 1200);
      });
      await page.waitForTimeout(200);
      const scrolled = await page.evaluate(() => globalThis.scrollY);
      expect(scrolled > 500, `${path}: the page scrolled (${scrolled}px)`);
      const box = await bar.boundingBox();
      expect(
        box !== null && Math.abs(box.y) <= 1,
        `${path}: after scrolling the header is still at the top (y=${box?.y})`,
      );
    }
  }));
