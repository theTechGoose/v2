/**
 * REQ-781 — demo-loop cycle dv1, issue d7 "No empty strip is reserved for the demo pill".
 * Raphael: "the gap reserved for the demo pill ... that's not a decision" (fix it).
 *
 * A super admin opens a demo on an onboarded contractor with a customer and a sent quote. On the
 * contractor's side, at 1280×720 and at 390×844, on /dashboard, /quotes, the quote opened in
 * /quotes and the public /q page — at the page's top, mid-scroll and at its end:
 *   - no band is kept for the pill: --demo-pill-h is unset, the body has no bottom padding, the
 *     overlay paints no band, and the app's shell reaches the window's foot;
 *   - the pill (whole or folded to its mini-pill) is on screen and floats over the page without
 *     covering anything interactive (no link, button, field or other control under any point of it).
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

/** the room kept for the pill and what the pill covers, in the customer's page */
const probe = () => {
  const CONTROL =
    'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"]';
  const pill = document.querySelector<HTMLElement>(
    "[data-cy='demo-pill-tab']",
  ) ?? document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  const band = document.querySelector<HTMLElement>("[data-cy='demo-band']");
  const app = document.querySelector(".app")?.getBoundingClientRect() ?? null;
  const r = pill?.getBoundingClientRect() ?? null;
  const covered = new Set<string>();
  if (r && r.width > 0) {
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 3; j++) {
        const x = r.left + 1 + ((r.width - 2) * i) / 12;
        const y = r.top + 1 + ((r.height - 2) * j) / 3;
        const top = document.elementsFromPoint(x, y)
          .find((n) => !n.closest("[data-demo-overlay]"));
        const c = top?.closest(CONTROL);
        if (c) {
          covered.add(
            `${c.tagName.toLowerCase()} "${
              (c.textContent ?? c.getAttribute("aria-label") ?? "").trim()
                .slice(0, 30)
            }" @${Math.round(x)},${Math.round(y)}`,
          );
        }
      }
    }
  }
  return {
    room: document.documentElement.style.getPropertyValue("--demo-pill-h"),
    pad: document.body.style.paddingBottom,
    bandH: band ? Math.round(band.getBoundingClientRect().height) : 0,
    appBottom: app ? Math.round(app.bottom) : null,
    vh: innerHeight,
    vw: innerWidth,
    pill: r
      ? {
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
      }
      : null,
    covered: [...covered],
  };
};

Deno.test("REQ-781 (demo-loop cycle dv1, d7): during a demo no empty strip is kept for the customer's pill — on /dashboard, /quotes, an open quote and /q at 1280×720 and 390×844 the app reaches the window's foot and the floating pill covers no control", (t) =>
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
    const customer = await post(http, user.auth, "/api/customers", {
      name: "Ana Pérez",
      email: "ana@blackhole.postmarkapp.com",
    });
    const quote = await post(http, user.auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Interior repaint",
      jobName: "Interior repaint",
      lineItems: [{
        description: "Interior repaint, three rooms",
        quantity: 1,
        unit: "job",
        price: 480000,
      }],
      estimatedTotal: 480000,
      status: "draft",
    });
    await (await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ status: "sent" }),
    })).body?.cancel();

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
      viewport: { width: 1280, height: 720 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      // a cold dev server builds the islands on the first load
      await userPage.goto(`${baseUrl}/dashboard`, { timeout: 180_000 });

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

      const pages = [
        "/dashboard",
        "/quotes",
        `/quotes?open=${quote.id}`,
        `/q/${quote.id}`,
      ];
      const sizes = [
        { width: 1280, height: 720 },
        { width: 390, height: 844 },
      ];
      for (const size of sizes) {
        await userPage.setViewportSize(size);
        for (const path of pages) {
          await userPage.goto(`${baseUrl}${path}`, { timeout: 120_000 });
          await userPage.locator("[data-cy='demo-pill'][data-status='live']")
            .waitFor({ state: "attached", timeout: 90_000 });
          for (const frac of [0, 0.5, 1]) {
            await userPage.evaluate(scrollAll, frac);
            const where = `${size.width}×${size.height} ${path} at ${
              frac * 100
            }% scrolled`;
            try {
              await until(
                `${where}: no strip is kept for the pill, and the pill covers no control`,
                async () => {
                  const p = await userPage.evaluate(probe);
                  const ok = (p.room === "" || p.room === "0px") &&
                    (p.pad === "" || p.pad === "0px") && p.bandH === 0 &&
                    (p.appBottom === null || p.appBottom >= p.vh - 1) &&
                    p.pill !== null && p.pill.left >= 0 &&
                    p.pill.right <= p.vw && p.pill.top >= 0 &&
                    p.pill.bottom <= p.vh && p.covered.length === 0;
                  return ok ? null : JSON.stringify(p);
                },
              );
            } catch (e) {
              await userPage.screenshot({
                path: `${folder}/${size.width}-${
                  path.replace(/\W+/g, "_")
                }-${frac}.png`,
              });
              throw e;
            }
          }
          // what the customer sees once settled, at the page's end: no strip, nothing covered
          const p = await userPage.evaluate(probe);
          expect.eq(
            JSON.stringify({
              room: p.room || "0px",
              pad: p.pad || "0px",
              band: p.bandH,
              appToFoot: p.appBottom === null || p.appBottom >= p.vh - 1,
              covered: p.covered,
            }),
            JSON.stringify({
              room: "0px",
              pad: "0px",
              band: 0,
              appToFoot: true,
              covered: [],
            }),
            `${size.width}×${size.height} ${path}: no strip kept, the pill covers no control`,
          );
          await userPage.screenshot({
            path: `${folder}/${size.width}-${path.replace(/\W+/g, "_")}.png`,
          });
        }
      }
    } finally {
      await userCtx.close();
    }
  }));
