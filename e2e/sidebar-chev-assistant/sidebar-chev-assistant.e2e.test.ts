/**
 * REQ-738 — demo-loop cycle 5, issue p13: on /assistant the sidebar's folder chevrons sat right
 * after the label ("Billing >") while every other page right-aligned them. The `.nav-item__chev`
 * rules lived only in dashboard.css, which /assistant does not link. They now ride with the
 * DashSidebar island, so /assistant and /dashboard put the chevron at the same right edge.
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
    name: "Chev User",
    businessName: "Chev Business",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** the gap between the Billing folder chevron's right edge and its row's right edge, and the
 *  gap between the label's right edge and the chevron's left edge */
function chevGeometry(page: StoryTools["page"]) {
  return page.evaluate(() => {
    const row = document.querySelector("[data-cy='nav-folder-billing']");
    const chev = row?.querySelector(".nav-item__chev");
    const label = row?.querySelector(".nav-item__label");
    if (!row || !chev || !label) return null;
    const r = row.getBoundingClientRect();
    const c = chev.getBoundingClientRect();
    const l = label.getBoundingClientRect();
    return {
      marginLeft: getComputedStyle(chev).marginLeft,
      rightGap: Math.round(r.right - c.right),
      labelGap: Math.round(c.left - l.right),
    };
  });
}

Deno.test("REQ-738: the sidebar folder chevron is right-aligned on /assistant exactly as on /dashboard (cycle 5, p13)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1440, height: 900 });
    const seen: Record<string, Awaited<ReturnType<typeof chevGeometry>>> = {};
    for (const route of ["/dashboard", "/assistant"]) {
      await page.goto(route);
      await page.locator("[data-cy='nav-folder-billing'] .nav-item__chev")
        .waitFor({ state: "visible", timeout: 15_000 });
      seen[route] = await chevGeometry(page);
    }
    const dash = seen["/dashboard"]!;
    const asst = seen["/assistant"]!;
    expect(
      asst.marginLeft !== "0px",
      `/assistant chevron has margin-left:auto (got ${asst.marginLeft})`,
    );
    expect(
      asst.labelGap > 20,
      `/assistant chevron is pushed away from the label (gap ${asst.labelGap}px)`,
    );
    expect(
      Math.abs(asst.rightGap - dash.rightGap) <= 2,
      `/assistant chevron sits at the same right edge as /dashboard (${asst.rightGap}px vs ${dash.rightGap}px)`,
    );
  }));
