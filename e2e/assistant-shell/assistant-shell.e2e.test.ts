/**
 * REQ-052 — "everything needs to extend to 100% viewport": the assistant
 * shell is exactly the browser window, tall or short.
 * REQ-053 — "remove whatever the hell this is": the grey collapse box at the
 * bottom of the sidebar is gone on every page; the topbar hamburger still
 * collapses the rail.
 *
 * Pages: front-end/routes/assistant/index.tsx (stylesheet
 * front-end/static/assistant-page.css), the sidebar island
 * front-end/islands/DashSidebar.tsx.
 */
import { story, type StoryTools } from "#shots";

const PHONE = "+15125550991";
const JSON_HEADERS = { "content-type": "application/json" };

/** A signed-in, onboarded account on the page's browser context. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: PHONE, code: "000000" }),
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
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Shell User" }],
      ["/api/profile/identity", { businessName: "Shell Business" }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
  const [name, value] = cookie.split("=");
  // The cookie must be set for the host the runner actually serves on — the
  // gate uses 127.0.0.1, a pin uses localhost; a cookie for the wrong one
  // leaves the page signed out.
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "es", domain: host, path: "/" },
  ]);
}

interface ShellMetrics {
  innerHeight: number;
  appBottom: number;
  footerBottom: number | null;
}
function measure(page: StoryTools["page"]): Promise<ShellMetrics> {
  return page.evaluate(() => {
    const app = document.querySelector(".app")?.getBoundingClientRect();
    const footer = document.querySelector(".site-footer, footer")
      ?.getBoundingClientRect();
    return {
      innerHeight: globalThis.innerHeight,
      appBottom: Math.round(app?.bottom ?? -1),
      footerBottom: footer ? Math.round(footer.bottom) : null,
    };
  });
}

Deno.test("REQ-052: the assistant shell is exactly the viewport, tall or short", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    for (const height of [1000, 760]) {
      await page.setViewportSize({ width: 1440, height });
      await page.goto("/assistant");
      await page.locator(".asst").waitFor({ state: "visible" });
      const m = await measure(page);
      expect.eq(m.innerHeight, height, `viewport is ${height}px tall`);
      expect.eq(
        m.appBottom,
        height,
        `the shell ends exactly at the bottom of a ${height}px window`,
      );
      expect(
        m.footerBottom !== null && m.footerBottom <= height,
        `the footer is inside a ${height}px window (bottom ${m.footerBottom})`,
      );
    }
  }));

Deno.test("REQ-053: the sidebar has no collapse button on any page; the topbar hamburger still collapses it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of ["/assistant", "/dashboard"]) {
      await page.goto(path);
      await page.locator(".sb").waitFor({ state: "visible" });
      expect.eq(
        await page.locator(".sb__collapse").count(),
        0,
        `${path}: no collapse button in the rail`,
      );
      expect.eq(
        await page.locator(
          "[data-cy=sidebar-collapse], [data-cy=sidebar-expand]",
        ).count(),
        0,
        `${path}: no collapse/expand control in the rail`,
      );
    }
    await page.click("[data-cy=mobile-menu]");
    await page.locator(".sb.sb--collapsed").waitFor({ state: "visible" });
    expect(
      await page.locator(".sb").evaluate((el) =>
        el.classList.contains("sb--collapsed")
      ),
      "the topbar hamburger still collapses the rail",
    );
  }));
