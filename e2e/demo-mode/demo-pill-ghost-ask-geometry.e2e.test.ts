/**
 * REQ-835 (demo-loop cycle dm2, issues m2 + M2; amends REQ-816 / REQ-228 / REQ-822) — End's open
 * question, the same on both screens and kept on the customer's.
 *
 * m2: the stage's copy of the customer's asking pill used an OLD position (atRef from before the
 * question, plus the new size): opened from the right-edge mini-pill at 1280 it was cut at the
 * frame's edge with "…", and on a 390 phone it was a strip at the old top; and the ghost never
 * wrapped. M2: narrowing the window while the question is up left the pill where it was at 1280
 * (x 611 → 977 on a 390 window).
 *
 * A super admin opens a demo on Ana (1280×800). Her page leaves the pill only its mini-pill on the
 * right edge; she taps its × (End). The stage's ghost, in her pixels, is her pill's box (± 3 px),
 * uncut. Her window then narrows to 390×844 with the question still up: her pill stays inside
 * (right ≤ 390 − 12), the ghost is again her pill's box, and it wraps into rows as hers does.
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
  document.getElementById("req835-cover")?.remove();
  const z = 2147482990;
  const page = document.createElement("div");
  page.id = "req835-cover";
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

/** the stage's ghost of the customer's pill, in the customer's px (through the frame's scale) */
const ghostProbe = () => {
  const frame = document.querySelector<HTMLIFrameElement>(
    "[data-cy='demo-frame']",
  );
  const g = document.querySelector<HTMLElement>("[data-cy='demo-pill-ghost']");
  if (!frame || !g) return null;
  const f = frame.getBoundingClientRect();
  const w = Number(frame.getAttribute("width"));
  const s = f.width / w;
  const r = g.getBoundingClientRect();
  const rows = (sel: string) => {
    const tops = new Set<number>();
    for (const c of Array.from(g.querySelectorAll<HTMLElement>(sel))) {
      tops.add(Math.round(c.getBoundingClientRect().top / 4));
    }
    return tops.size;
  };
  return {
    screenW: w,
    left: Math.round((r.left - f.left) / s),
    top: Math.round((r.top - f.top) / s),
    right: Math.round((r.right - f.left) / s),
    bottom: Math.round((r.bottom - f.top) / s),
    clipped: g.hasAttribute("data-clipped"),
    ask: g.querySelector("[data-cy='demo-pill-ghost-ask']") !== null,
    wrap: getComputedStyle(g).flexWrap,
    rows: rows(":scope > *"),
    yesBelowAsk: (() => {
      const a = g.querySelector("[data-cy='demo-pill-ghost-ask']");
      const y = g.querySelector("[data-cy='demo-pill-ghost-yes']");
      return a && y
        ? y.getBoundingClientRect().top >= a.getBoundingClientRect().bottom - 1
        : null;
    })(),
  };
};

/** the customer's pill, and how many rows its children sit on */
const pillRows = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  if (!pill) return 0;
  const tops = new Set<number>();
  for (
    const c of Array.from(pill.querySelectorAll<HTMLElement>(":scope > *"))
  ) {
    const r = c.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top / 4));
  }
  return tops.size;
};

/** a screenshot, best effort: a busy host's capture error never hides the real failure */
// deno-lint-ignore no-explicit-any
const snap = async (p: any, o: { path: string }) => {
  await p.screenshot(o).catch(() => {});
};

const near = (a: number, b: number) => Math.abs(a - b) <= 3;

Deno.test("REQ-835 (demo-loop cycle dm2, m2 + M2): End's open question — the stage's ghost is the customer's pill box at 1280 and, after the window narrows to 390, the pill stays inside and the ghost wraps like it", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await setMe(http, user.auth, "Ana Torres", "en");
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
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie, "en");
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
      await userPage.locator("[data-cy='demo-pill'][data-status='live']")
        .waitFor({ state: "attached", timeout: 25_000 });

      // the page leaves the pill only its mini-pill on the right edge
      await userPage.evaluate(cover);
      await until("the mini-pill folds on the right edge", async () => {
        const p = await userPage.evaluate(probe);
        return p.folded && p.pill && p.pill.right === p.vw
          ? null
          : JSON.stringify(p);
      }, 10_000);

      // its × is End: the question comes up
      await userPage.locator("[data-cy='demo-pill-tab-end']").click();
      await userPage.locator("[data-cy='demo-pill'] [data-cy='demo-end-ask']")
        .waitFor({ state: "visible", timeout: 5_000 });

      /** the ghost is the customer's pill box (± 3 px), uncut, drawing the question */
      const sameBox = async (tag: string, vw: number) => {
        let seen = "";
        await until(
          `${tag}: the stage's ghost is the customer's pill box, uncut`,
          async () => {
            const c = await userPage.evaluate(probe);
            const g = await page.evaluate(ghostProbe);
            seen = JSON.stringify({ customer: c.pill, ghost: g, vw: c.vw });
            if (!c.pill || !g || c.vw !== vw || g.screenW !== vw) return seen;
            return near(g.left, c.pill.left) && near(g.right, c.pill.right) &&
                near(g.top, c.pill.top) && near(g.bottom, c.pill.bottom) &&
                !g.clipped && g.ask
              ? null
              : seen;
          },
          12_000,
        ).catch(async (e) => {
          await snap(page, { path: `${folder}/${tag}-stage-RED.png` });
          await snap(userPage, {
            path: `${folder}/${tag}-customer-RED.png`,
          });
          throw e;
        });
        return seen;
      };

      // 1280: the customer's pill inside, and the ghost is it
      await userPage.waitForTimeout(500); // past the glide (PILL_MOVE_MS)
      const d = await userPage.evaluate(probe);
      expect(
        d.pill !== null && d.pill.left >= 0 && d.pill.right <= d.vw - 12,
        `desktop: the asking pill is inside the window — ${JSON.stringify(d)}`,
      );
      await sameBox("desktop", 1280);
      await snap(userPage, { path: `${folder}/desktop-customer.png` });
      await snap(page, { path: `${folder}/desktop-stage.png` });

      // the window narrows to a phone with the question still up (M2)
      await userPage.setViewportSize({ width: 390, height: 844 });
      await until(
        "phone: the asking pill is pulled back inside the narrowed window",
        async () => {
          const p = await userPage.evaluate(probe);
          return p.vw === 390 && p.ask && p.pill && p.pill.left >= 0 &&
              p.pill.right <= p.vw - 12 && p.pill.top >= 0 &&
              p.pill.bottom <= p.vh
            ? null
            : JSON.stringify(p);
        },
        8_000,
      ).catch(async (e) => {
        await snap(userPage, { path: `${folder}/phone-customer-RED.png` });
        throw e;
      });
      await userPage.waitForTimeout(500);
      const seen = await sameBox("phone", 390);
      // the customer's pill wraps into rows; the ghost wraps the same way
      const rows = await userPage.evaluate(pillRows);
      const g = await page.evaluate(ghostProbe);
      expect(
        rows > 1 && g !== null && g.wrap === "wrap" && g.rows > 1 &&
          g.yesBelowAsk === true,
        `phone: the ghost wraps into rows like the customer's pill (${rows} rows) — ${
          JSON.stringify(g)
        } ${seen}`,
      );
      await snap(userPage, { path: `${folder}/phone-customer.png` });
      await snap(page, { path: `${folder}/phone-stage.png` });
    } finally {
      await userCtx.close();
    }
  }));
