/**
 * REQ-818 — demo-loop cycle dm1, issue m5 "Demo pill covers page content (sidebar Log out, phone
 * headings, footer)". Raphael: "fix every issue the demo found, loop until there are none".
 *
 * Demo 3 saw the customer's mini-pill at 0,760 (96×32) over the desktop sidebar's "Log out" button
 * on /customers at 1280×800: placePill's last resort put it on the first tab spot (bottom-left) even
 * though that spot holds a control. A contractor with a long customer list, in a demo, at 1280×800
 * on /customers and /dashboard — at the page's top, mid-scroll and at its end — the pill (whole or
 * folded) never overlaps `.nav-item--logout`, and covers no control.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

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
  return { body, cookie, auth: { ...JSON_HEADERS, cookie } };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(`POST ${path} → ${r.status} ${JSON.stringify(json)}`);
  }
  return json;
}

// deno-lint-ignore no-explicit-any
async function useCookie(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
}

/** wait for a condition, polling; throws with `what` (and the last detail) when it never comes */
async function until(
  what: string,
  cond: () => Promise<string | null>,
  timeout = 10_000,
) {
  const t0 = Date.now();
  let last: string | null = "never asked";
  while (Date.now() - t0 < timeout) {
    try {
      last = await cond();
      if (last === null) return;
    } catch (e) {
      last = String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out: ${what} — ${last}`);
}

/** scroll the document and every scroller of the page to `frac` of its way down */
const scrollAll = (frac: number) => {
  const all = [
    document.scrollingElement,
    ...document.querySelectorAll<HTMLElement>("body *"),
  ];
  for (const el of all) {
    if (!el || el.closest("[data-demo-overlay]")) continue;
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    if (el !== document.scrollingElement) {
      const oy = getComputedStyle(el).overflowY;
      if (oy !== "auto" && oy !== "scroll") continue;
    }
    el.scrollTop = (el.scrollHeight - el.clientHeight) * frac;
  }
};

/** the pill's box (the mini-pill's when folded), Log out's box, and the controls under the pill */
const probe = () => {
  const CONTROL =
    'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"]';
  const box = (el: Element | null) => {
    const r = el?.getBoundingClientRect();
    return r && r.width > 0
      ? {
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
      }
      : null;
  };
  const pillEl = document.querySelector("[data-cy='demo-pill-tab']") ??
    document.querySelector("[data-cy='demo-pill']");
  const pill = box(pillEl);
  const logout = box(document.querySelector(".nav-item--logout"));
  const covered: string[] = [];
  if (pill) {
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 3; j++) {
        const x = pill.left + 1 + ((pill.right - pill.left - 2) * i) / 12;
        const y = pill.top + 1 + ((pill.bottom - pill.top - 2) * j) / 3;
        const top = document.elementsFromPoint(x, y)
          .find((n) => !n.closest("[data-demo-overlay]"));
        const c = top?.closest(CONTROL);
        if (c) {
          covered.push(
            `${c.tagName.toLowerCase()} "${
              (c.textContent ?? "").trim().slice(0, 30)
            }" @${Math.round(x)},${Math.round(y)}`,
          );
        }
      }
    }
  }
  const overLogout = !!pill && !!logout && pill.left < logout.right &&
    logout.left < pill.right && pill.top < logout.bottom &&
    logout.top < pill.bottom;
  return {
    pill,
    logout,
    tucked: !!document.querySelector("[data-cy='demo-pill-tab']"),
    overLogout,
    covered: [...new Set(covered)],
  };
};

Deno.test("REQ-818 (demo-loop cycle dm1, m5): at 1280×800 on /customers and /dashboard the customer's demo pill is never over the sidebar's Log out button and covers no control", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Maria Castro" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Maria Castro",
      businessName: "Castro Painting",
    });
    // a list long enough to reach the window's foot
    for (let i = 1; i <= 14; i++) {
      await post(http, user.auth, "/api/customers", {
        name: `Customer ${String(i).padStart(2, "0")}`,
        email: `c${i}-${digits()}@blackhole.postmarkapp.com`,
      });
    }

    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      body: JSON.stringify({ language: "en", name: "Alex from DocuMonster" }),
    })).body?.cancel();
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    if (boot.status !== 200) throw new Error(`bootstrap → ${boot.status}`);
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      // a cold dev server builds the islands on the first load
      await userPage.goto(`${baseUrl}/customers`, { timeout: 180_000 });

      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto("/admin");
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.waitForURL((u) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });

      for (const path of ["/customers", "/dashboard"]) {
        await userPage.goto(`${baseUrl}${path}`, { timeout: 120_000 });
        await userPage.locator("[data-cy='demo-pill'][data-status='live']")
          .waitFor({ state: "attached", timeout: 90_000 });
        await userPage.locator(".nav-item--logout").waitFor({
          timeout: 15_000,
        });
        for (const frac of [0, 0.5, 1]) {
          await userPage.evaluate(scrollAll, frac);
          const where = `1280×800 ${path} at ${frac * 100}% scrolled`;
          try {
            await until(
              `${where}: the pill is off Log out and covers no control`,
              async () => {
                const p = await userPage.evaluate(probe);
                return p.pill && !p.overLogout && p.covered.length === 0
                  ? null
                  : JSON.stringify(p);
              },
            );
          } catch (e) {
            await userPage.screenshot({
              path: `${folder}/${path.replace(/\W+/g, "_")}-${frac}.png`,
            });
            throw e;
          }
          // settled: still off it a check later (PILL_CHECK_MS)
          await userPage.waitForTimeout(800);
          const p = await userPage.evaluate(probe);
          expect.eq(
            JSON.stringify({ overLogout: p.overLogout, covered: p.covered }),
            JSON.stringify({ overLogout: false, covered: [] }),
            `${where}: the pill (${
              JSON.stringify(p.pill)
            }) is not over Log out (${JSON.stringify(p.logout)})`,
          );
        }
        await userPage.screenshot({
          path: `${folder}/${path.replace(/\W+/g, "_")}.png`,
        });
      }

      // A page with a control under EVERY spot the pill may take (demo 3's /customers had them up
      // both edges, along the foot and in the corners): a layer of buttons over the whole window,
      // but for a gap along the foot right of the sidebar. The last resort used to put the
      // mini-pill on the first tab spot — 0,760, Log out; it goes to the spot with the fewest.
      await userPage.goto(`${baseUrl}/customers`, { timeout: 120_000 });
      await userPage.locator("[data-cy='demo-pill'][data-status='live']")
        .waitFor({ state: "attached", timeout: 90_000 });
      await userPage.locator(".nav-item--logout").waitFor({ timeout: 15_000 });
      await userPage.evaluate(() => {
        const layer = document.createElement("div");
        layer.id = "req818-crowd";
        layer.style.cssText =
          "position:fixed;inset:0;z-index:2147483000;pointer-events:none";
        for (let y = 0; y < innerHeight; y += 80) {
          for (let x = 0; x < innerWidth; x += 80) {
            // the gap: one tile along the foot, x 480–560 — no spot is wholly clear
            if (y >= innerHeight - 80 && x === 480) continue;
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = "·";
            b.style.cssText =
              `position:absolute;left:${x}px;top:${y}px;width:80px;height:80px;pointer-events:auto;opacity:.15`;
            layer.append(b);
          }
        }
        document.body.append(layer);
      });
      const crowd = () =>
        userPage.evaluate(() => {
          const logout = document.querySelector(".nav-item--logout")!
            .getBoundingClientRect();
          const el = document.querySelector("[data-cy='demo-pill-tab']") ??
            document.querySelector("[data-cy='demo-pill']");
          const r = el!.getBoundingClientRect();
          return {
            pill: [r.left, r.top, r.width, r.height].map(Math.round),
            tucked: !!document.querySelector("[data-cy='demo-pill-tab']"),
            overLogout: r.left < logout.right && logout.left < r.right &&
              r.top < logout.bottom && logout.top < r.bottom,
          };
        });
      try {
        await until(
          "1280×800 /customers, a control under every spot: the pill leaves Log out",
          async () => {
            const c = await crowd();
            return c.overLogout ? JSON.stringify(c) : null;
          },
        );
      } catch (e) {
        await userPage.screenshot({ path: `${folder}/crowded.png` }).catch(
          () => {},
        );
        throw e;
      }
      // placed again within a check or two (PILL_CHECK_MS) of the layer
      await userPage.waitForTimeout(2_000);
      const c = await crowd();
      await userPage.screenshot({ path: `${folder}/crowded.png` }).catch(
        () => {},
      );
      expect.eq(
        c.overLogout,
        false,
        `a control under every spot: the pill (${
          JSON.stringify(c.pill)
        }) is not over Log out`,
      );
    } finally {
      await userCtx.close();
    }
  }));
