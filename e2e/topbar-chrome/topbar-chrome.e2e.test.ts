/**
 * REQ-223 — the topbar's EN/ES toggle is styled, and never sits on the search
 * box, on every page that renders DashTopbar — /assistant included (demo
 * issues i18n-formatting-m6 and i18n-formatting-m11).
 *
 * /assistant links only assistant-page.css; the toggle's rules and the phone
 * rule that hides the search lived only in dashboard.css. The island now
 * ships them itself (front-end/lib/topbar-css.ts).
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  await answerQuestions(http, { ...JSON_HEADERS, cookie }, {
    name: "Topbar User",
    businessName: "Topbar Business",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "es", domain: host, path: "/" },
  ]);
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Chrome {
  lang: Box | null;
  search: Box | null;
  searchShown: boolean;
  btnBorder: string;
  btnBg: string;
  onBg: string;
  btnTops: number[];
}

function chrome(page: StoryTools["page"]): Promise<Chrome> {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const search = document.querySelector(".topbar__search");
    const btns = [...document.querySelectorAll(".topbar__lang-btn")];
    const off = btns.find((b) => !b.classList.contains("topbar__lang-btn--on"));
    const on = document.querySelector(".topbar__lang-btn--on");
    const cs = (el: Element | undefined | null) =>
      el ? getComputedStyle(el) : null;
    return {
      lang: box(document.querySelector(".topbar__lang")),
      search: box(search),
      searchShown: !!search && getComputedStyle(search).display !== "none",
      btnBorder: cs(off)?.borderTopStyle ?? "",
      btnBg: cs(off)?.backgroundColor ?? "",
      onBg: cs(on)?.backgroundColor ?? "",
      btnTops: btns.map((b) => Math.round(b.getBoundingClientRect().top)),
    };
  });
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

Deno.test("REQ-223: the EN/ES toggle is styled and clear of the search box on /assistant and /dashboard, desktop and 390px phone", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    for (
      const [route, width, height] of [
        ["/assistant", 1440, 900],
        ["/assistant", 390, 844],
        ["/dashboard", 1440, 900],
        ["/dashboard", 390, 844],
      ] as const
    ) {
      await page.setViewportSize({ width, height });
      await page.goto(route);
      await page.locator(".topbar__lang").waitFor({ state: "visible" });
      const c = await chrome(page);
      // m11: not the browser's grey bordered boxes
      expect.eq(
        c.btnBorder,
        "none",
        `${route} ${width}px: the off button has no border`,
      );
      expect.eq(
        c.btnBg,
        "rgba(0, 0, 0, 0)",
        `${route} ${width}px: the off button is transparent`,
      );
      expect.eq(
        c.onBg,
        "rgb(255, 255, 255)",
        `${route} ${width}px: the lit button is white`,
      );
      // m6: EN and ES on one row, and not on top of the search
      expect.eq(c.btnTops.length, 2, `${route} ${width}px: two buttons`);
      expect.eq(
        c.btnTops[0],
        c.btnTops[1],
        `${route} ${width}px: EN and ES sit on one row (${c.btnTops})`,
      );
      if (width <= 640) {
        expect(
          !c.searchShown,
          `${route} ${width}px: the search box is hidden on a phone, as on the dashboard`,
        );
      }
      if (c.searchShown && c.search && c.lang) {
        expect(
          !overlaps(c.lang, c.search),
          `${route} ${width}px: the toggle does not overlap the search box`,
        );
      }
    }
  }));
