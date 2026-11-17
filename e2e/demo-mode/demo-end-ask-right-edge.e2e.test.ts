/**
 * REQ-816 (demo-loop cycle dm1, issue M1) — the customer could not confirm or dismiss End's
 * question: with the mini-pill folded on the RIGHT edge (REQ-781), its × opened the whole pill flush
 * right at its width at rest, End's question then made it ~250 px wider (on a phone, two rows at
 * the window's width) while REQ-300 froze its place, so it ran past the window's right edge and
 * "Yes, end it" / "Keep going" were off-screen (desktop 1280×800 and phone 390×844, EN and ES).
 *
 * A super admin opens a demo on Ana. On her screen a page fills the window with text and its whole
 * left side is a control, so the pill yields to its mini-pill on the right edge (as on the demo's
 * pages). She taps the mini-pill's × (End): the question and both answers are inside the window,
 * and a real click on "Yes, end it" ("Sí, terminar") ends the demo.
 */
import { story, type StoryTools } from "#shots";

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

async function setMe(
  http: StoryTools["http"],
  auth: Record<string, string>,
  name: string,
  language: string,
) {
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language, name }),
  })).body?.cancel();
}

async function useCookie(
  // deno-lint-ignore no-explicit-any
  ctx: any,
  baseUrl: string,
  cookie: string,
  lang: string,
) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: lang, domain, path: "/" },
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
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out: ${what} — ${last}`);
}

/** a page with text under every spot and a control down its whole left side (under the overlay) */
const cover = () => {
  document.getElementById("req816-cover")?.remove();
  const z = 2147482990;
  const page = document.createElement("div");
  page.id = "req816-cover";
  page.style.cssText =
    `position:fixed;inset:0;z-index:${z};background:#fff;color:#333;font:14px/18px sans-serif;overflow:hidden;word-break:break-all`;
  page.textContent = "Lorem ipsum dolor sit amet ".repeat(300);
  const side = document.createElement("button");
  side.type = "button";
  side.textContent = "Side control";
  side.style.cssText =
    `position:fixed;left:0;top:0;bottom:0;width:140px;z-index:${
      z + 1
    };background:#eee;border:0`;
  page.appendChild(side);
  document.body.appendChild(page);
};

/** the customer's pill and End's answers, as laid out */
const probe = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  const box = (el: Element | null | undefined) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
    };
  };
  return {
    folded: pill?.hasAttribute("data-tucked") ?? null,
    status: pill?.dataset.status ?? "",
    pill: box(pill),
    ask: box(pill?.querySelector("[data-cy='demo-end-ask']")),
    yes: box(pill?.querySelector("[data-cy='demo-end-confirm']")),
    keep: box(pill?.querySelector("[data-cy='demo-end-cancel']")),
    vw: innerWidth,
    vh: innerHeight,
  };
};

const VIEWS = [
  { w: 1280, h: 800, tag: "desktop" },
  { w: 390, h: 844, tag: "phone" },
] as const;

for (
  const L of [
    { lang: "en", yes: "Yes, end it", ended: "You ended the demo" },
    { lang: "es", yes: "Sí, terminar", ended: "" },
  ] as const
) {
  Deno.test(`REQ-816 (demo-loop cycle dm1, M1) [${L.lang}]: the mini-pill folded on the RIGHT edge — its × asks End inside the window at 1280×800 and 390×844, and a real click on '${L.yes}' ends the demo`, (t) =>
    story(t, async ({ page, expect, http, baseUrl, folder }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const userPhone = `+1512${digits()}`;
      const adminPhone = `+1843${digits()}`;
      const user = await verify(http, userPhone);
      await setMe(http, user.auth, "Ana Torres", L.lang);
      const admin = await verify(http, adminPhone);
      await setMe(http, admin.auth, "Alexandra Whitfield", "en");
      const boot = await http("/api/admin/bootstrap", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ phoneNumber: adminPhone }),
      });
      expect.eq(boot.status, 200, "Alexandra is a super admin");
      await boot.body?.cancel();
      await useCookie(page.context(), baseUrl, admin.cookie, "en");

      const browser = page.context().browser();
      if (!browser) throw new Error("no browser behind the story page");
      for (const v of VIEWS) {
        const userCtx = await browser.newContext({
          viewport: { width: v.w, height: v.h },
        });
        try {
          const userPage = await userCtx.newPage();
          await useCookie(userCtx, baseUrl, user.cookie, L.lang);
          await userPage.goto(`${baseUrl}/dashboard`);

          await page.goto(`${baseUrl}/admin`);
          await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
          await page.locator("[data-cy='adm-search']").click();
          await page.locator("[data-cy='adm-demo']").first().waitFor({
            timeout: 15_000,
          });
          await page.locator("[data-cy='adm-demo']").first().click();
          await page.waitForURL((u) => u.pathname === "/demo/stage", {
            timeout: 20_000,
          });
          await userPage.reload();
          await userPage.locator(
            "[data-cy='demo-pill'][data-status='live']",
          ).waitFor({ state: "attached", timeout: 25_000 });

          // the page leaves the pill only its mini-pill on the right edge
          await userPage.evaluate(cover);
          await until(
            `${v.tag}: the mini-pill folds on the right edge`,
            async () => {
              const p = await userPage.evaluate(probe);
              return p.folded && p.pill && p.pill.right === p.vw
                ? null
                : JSON.stringify(p);
            },
            10_000,
          );
          await userPage.screenshot({
            path: `${folder}/${L.lang}-${v.tag}-mini-pill.png`,
          });

          // its × is End: the question comes up on the whole pill, inside the window
          await userPage.locator("[data-cy='demo-pill-tab-end']").click();
          await userPage.locator(
            "[data-cy='demo-pill'] [data-cy='demo-end-ask']",
          ).waitFor({ state: "visible", timeout: 5_000 });
          // past the pill's glide (PILL_MOVE_MS)
          await userPage.waitForTimeout(500);
          const a = await userPage.evaluate(probe);
          await userPage.screenshot({
            path: `${folder}/${L.lang}-${v.tag}-asking.png`,
          });
          const inside = (b: typeof a.pill) =>
            b !== null && b.left >= 0 && b.right <= a.vw - 12 && b.top >= 0 &&
            b.bottom <= a.vh;
          expect(
            inside(a.pill) && inside(a.ask) && inside(a.yes) &&
              inside(a.keep),
            `${v.tag} ${L.lang}: the asking pill, its question, Yes and Keep going are inside the window (right edge ≤ ${
              a.vw - 12
            }) — ${JSON.stringify(a)}`,
          );

          // a real click (no force) on Yes ends the demo
          await userPage.getByRole("button", { name: L.yes, exact: true })
            .click({ timeout: 5_000 });
          await userPage.locator("[data-cy='demo-ended']").waitFor({
            timeout: 15_000,
          });
          if (L.ended) {
            expect(
              ((await userPage.locator("[data-cy='demo-ended']")
                .textContent()) ?? "").includes(L.ended),
              `${v.tag}: the customer's screen says "${L.ended}"`,
            );
          }
          // the stage shows "The demo ended" 1.5 s, then returns the staff's account and hops to
          // /admin on its own (REQ-235 / REQ-541): the next viewport starts from there — a goto
          // /admin during those 1.5 s would leave the browser impersonating (the guide gate)
          await page.waitForURL((u) => u.pathname === "/admin", {
            timeout: 20_000,
          });
        } finally {
          await userCtx.close();
        }
      }
    }));
}
