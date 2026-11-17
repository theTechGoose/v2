/**
 * REQ-517 (demo-loop cycle 3, demo issue p8-pair8-a) — "Collapsed sidebar
 * icons have no tooltips". Collapse the rail with the topbar hamburger on
 * /dashboard: every icon row (Dashboard, Customers, Quotes, …, Worker view,
 * Log out) carries a hover title and an accessible name.
 *
 * Island: front-end/islands/DashSidebar.tsx.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  await answerQuestions(http, auth, {
    name: "Rail User",
    businessName: "Rail Business",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

Deno.test("REQ-517 (demo p8-pair8-a, cycle 3): the collapsed sidebar's icon rows each carry a tooltip and an accessible name", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    await page.locator(".sb").waitFor({ state: "visible" });
    const dash = page.locator('.sb__nav a[href="/dashboard"]');
    // the row's own visible label (in whatever language the account renders) is its name
    const label =
      (await dash.locator(".nav-item__label").textContent())?.trim() ?? "";
    expect(label !== "", "the expanded Dashboard row shows its label");
    await page.click("[data-cy=mobile-menu]");
    await page.locator(".sb.sb--collapsed").waitFor({ state: "visible" });
    // the label spans have left the rail once the island re-rendered collapsed
    await page.waitForFunction(() =>
      document.querySelectorAll(".sb__nav .nav-item__label").length === 0
    );
    const rows = await page.locator(".sb .nav-item").evaluateAll((els) =>
      els.map((el) => ({
        html: el.outerHTML.slice(0, 120),
        title: el.getAttribute("title") ?? "",
        aria: el.getAttribute("aria-label") ?? "",
      }))
    );
    expect(rows.length > 3, `the rail renders its rows (${rows.length})`);
    for (const r of rows) {
      expect(r.title.trim() !== "", `no tooltip on ${r.html}`);
      expect(r.aria.trim() !== "", `no accessible name on ${r.html}`);
    }
    expect.eq(await dash.getAttribute("title"), label, "Dashboard tooltip");
    expect.eq(await dash.getAttribute("aria-label"), label, "Dashboard name");
  }));
