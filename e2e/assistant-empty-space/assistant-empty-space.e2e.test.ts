/**
 * REQ-425 — demo-loop cycle 2, issues p6 + p13-b ("fix every issue the demo
 * found, loop until there are none"):
 *  - p6: the full marketing SiteFooter (two-by-two policy grid, then the phone,
 *    then the address: 120-150 px) closed every signed-in app page, taking that
 *    height from the chat and the in-chat calendar. Inside the app it is one
 *    compact line now: the four policy links, the phone and the address.
 *    The public pages (login, the customer documents…) keep the full footer.
 *  - p13-b: the chat scroller pinned itself to the bottom on mount and on every
 *    inner resize (AsstChat.tsx), so when the empty-state block was taller than
 *    the scroller the mascot at its top sat scrolled out of view. The empty
 *    state now opens at its top.
 *
 * Pages: front-end/routes/assistant/index.tsx, front-end/islands/AsstChat.tsx,
 * front-end/components/SiteFooterView.tsx.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
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
    name: "Space User",
    businessName: "Space Business",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** Click until `done` holds — a click before hydration is a no-op, so retry it (house clickUntil). */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

interface FooterMetrics {
  height: number;
  compact: boolean;
  /** distinct row tops of the footer's links, phone and address */
  rows: number;
  phone: boolean;
  address: boolean;
  links: number;
}
function footer(page: StoryTools["page"]): Promise<FooterMetrics | null> {
  return page.evaluate(() => {
    const f = document.querySelector<HTMLElement>("[data-site-footer]");
    if (!f) return null;
    const items = [
      ...f.querySelectorAll<HTMLElement>(
        "[data-legal-link], [data-site-phone], [data-site-address]",
      ),
    ];
    const tops = new Set(
      items.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    return {
      height: Math.round(f.getBoundingClientRect().height),
      compact: f.hasAttribute("data-site-footer-compact"),
      rows: tops.size,
      phone: !!f.querySelector("[data-site-phone]"),
      address: !!f.querySelector("[data-site-address]"),
      links: f.querySelectorAll("[data-legal-link]").length,
    };
  });
}

Deno.test("REQ-425 (p6): inside the app the site footer is one compact line at 1280x720; the public pages keep the full footer", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 720 });
    const shots: [string, "en" | "es"][] = [
      ["/assistant", "es"],
      ["/assistant", "en"],
      ["/dashboard", "es"],
      ["/quotes", "en"],
    ];
    for (const [path, lang] of shots) {
      await page.goto(path);
      await page.locator("[data-site-footer]").waitFor({ state: "attached" });
      // both languages: the Spanish line is the long one
      await clickUntil(
        page,
        `[data-cy='topbar-lang-${lang}']`,
        async () =>
          (await page.evaluate(() => document.documentElement.lang)) === lang,
      );
      await page.waitForTimeout(300);
      const m = await footer(page);
      expect(
        m !== null,
        `${path} (${lang}): the page still ends with the site footer`,
      );
      expect(m!.compact, `${path} (${lang}): the footer is the compact one`);
      expect(
        m!.height <= 48,
        `${path} (${lang}): the footer is at most 48px tall (got ${m!.height})`,
      );
      expect.eq(
        m!.rows,
        1,
        `${path} (${lang}): links, phone and address share one line`,
      );
      expect.eq(
        m!.links,
        4,
        `${path} (${lang}): the four policy links are still there`,
      );
      expect(
        m!.phone && m!.address,
        `${path} (${lang}): REQ-044's phone and address stay`,
      );
    }
    await page.context().clearCookies();
    await page.goto("/login");
    await page.locator("[data-site-footer]").waitFor({ state: "attached" });
    const pub = await footer(page);
    expect(pub !== null && !pub.compact, "/login keeps the full footer");
  }));

Deno.test("REQ-425 (p13-b): the empty chat opens at its top — the mascot is in view, even when the welcome block is taller than the chat", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    for (const height of [720, 520]) {
      await page.setViewportSize({ width: 1280, height });
      await page.goto("/assistant");
      await page.locator(".chat__empty-icon").waitFor({ state: "visible" });
      // let hydration's mount pin and any ResizeObserver pin (smooth) land
      await page.waitForTimeout(1200);
      const m = await page.evaluate(() => {
        const s = document.querySelector<HTMLElement>(".chat__scroll")!;
        const sr = s.getBoundingClientRect();
        const ir = document.querySelector(".chat__empty-icon")!
          .getBoundingClientRect();
        return {
          scrollTop: Math.round(s.scrollTop),
          overflow: s.scrollHeight - s.clientHeight,
          scrollerTop: Math.round(sr.top),
          iconTop: Math.round(ir.top),
        };
      });
      expect.eq(
        m.scrollTop,
        0,
        `${height}px: the empty chat is not pinned to the bottom (overflow ${m.overflow}px)`,
      );
      expect(
        m.iconTop >= m.scrollerTop,
        `${height}px: the mascot's top (${m.iconTop}) is inside the chat (top ${m.scrollerTop})`,
      );
    }
  }));
