/**
 * REQ-866 (demo-loop cycle dm4, issues m2 + m2b) — the customer's pill's fallbacks count controls.
 *
 * m2: on /welcome at 1280×800 every one of REQ-852's five asking boxes held a control (the
 * centred brand link at the top, the full SiteFooter's centred phone link at the bottom), so End's
 * question stayed at the top-right anchor and covered the brand (fleet-rf5fcb8b9-0 stdout:60).
 * m2b: on a first join (REQ-821's grace, the pill may not fold) on /customers, every whole spot
 * held a control and the pill fell back to home, over the sidebar's "Cerrar sesión"
 * (fleet-rf5fcb8b9-3 stdout:83-86).
 *
 * 1. A new contractor (Spanish) sits on /welcome; a super admin opens a demo on her. She opens
 *    End's question: no control of the page is under the asking pill.
 * 2. A contractor (Spanish) with no customers yet sits on /customers (a short page: the app's
 *    footer links along the window's foot, Log out at the sidebar's foot); a demo opens on him.
 *    For the whole join grace the whole pill never overlaps the sidebar's Log out
 *    (.nav-item--logout).
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

/** the page's controls under the customer's pill: sampled as the overlay does, the pill skipped */
const controlsUnderPill = () => {
  const SEL =
    'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"]';
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  if (!pill) return { pill: null, under: [] as string[] };
  const r = pill.getBoundingClientRect();
  const found = new Map<Element, string>();
  const cols = Math.max(5, Math.ceil(r.width / 20));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < 5; j++) {
      const x = r.left + 2 + ((r.width - 4) * i) / (cols - 1);
      const y = r.top + 2 + ((r.height - 4) * j) / 4;
      for (const el of document.elementsFromPoint(x, y)) {
        if (pill.contains(el)) continue;
        if (el.closest("[data-demo-overlay],[data-cy^='demo-']")) continue;
        const c = el.closest(SEL);
        if (c) {
          const b = c.getBoundingClientRect();
          found.set(
            c,
            `${c.tagName} ${c.getAttribute("href") ?? ""} '${
              (c.textContent ?? "").trim().slice(0, 30)
            }' @${Math.round(b.left)},${Math.round(b.top)} ${
              Math.round(b.width)
            }x${Math.round(b.height)}`,
          );
        }
        break;
      }
    }
  }
  return {
    pill: [
      Math.round(r.left),
      Math.round(r.top),
      Math.round(r.width),
      Math.round(r.height),
    ],
    folded: pill.hasAttribute("data-tucked"),
    under: [...found.values()],
  };
};

async function openDemo(
  // deno-lint-ignore no-explicit-any
  staff: any,
  baseUrl: string,
  phone: string,
) {
  await staff.goto(`${baseUrl}/admin`);
  await staff.locator("[data-cy='adm-q']").fill(phone.slice(2));
  await staff.locator("[data-cy='adm-search']").click();
  await staff.locator("[data-cy='adm-demo']").first().waitFor({
    timeout: 15_000,
  });
  await staff.locator("[data-cy='adm-demo']").first().click();
  await staff.waitForURL((u: URL) => u.pathname === "/demo/stage", {
    timeout: 20_000,
  });
}

Deno.test("REQ-866 (demo-loop cycle dm4, m2) [es]: on /welcome at 1280×800 End's open question covers no control (not the brand, not the footer's phone link)", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await setMe(http, user.auth, "Ana Torres", "es");
    const admin = await verify(http, adminPhone);
    await setMe(http, admin.auth, "Alex from DocuMonster", "en");
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    expect.eq(boot.status, 200, "the admin phone is a super admin");
    await boot.body?.cancel();
    await useCookie(page.context(), baseUrl, admin.cookie, "en");

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie, "es");
      await userPage.goto(`${baseUrl}/welcome`);
      expect.eq(new URL(userPage.url()).pathname, "/welcome", "on /welcome");
      await openDemo(page, baseUrl, userPhone);
      await userPage.reload();
      await userPage.locator("[data-cy='demo-pill'][data-status='live']")
        .waitFor({ state: "attached", timeout: 25_000 });
      // past REQ-821's join grace and the pill's glide: it rests where the page leaves it
      await userPage.waitForTimeout(6_500);
      const rest = await userPage.evaluate(controlsUnderPill);
      await userPage.screenshot({ path: `${folder}/welcome-rest.png` });

      // End's question: from the whole pill's End, or the mini-pill's ×
      const end = userPage.locator(
        "[data-cy='demo-pill'] [data-cy='demo-end']",
      );
      if (await end.isVisible()) await end.click();
      else {
        await userPage.locator("[data-cy='demo-pill-tab-end']").click();
      }
      await userPage.locator("[data-cy='demo-pill'] [data-cy='demo-end-ask']")
        .waitFor({ state: "visible", timeout: 5_000 });
      await userPage.waitForTimeout(600);
      const a = await userPage.evaluate(controlsUnderPill);
      await userPage.screenshot({ path: `${folder}/welcome-asking.png` });
      expect(
        a.under.length === 0,
        `End's question covers no control of /welcome — asking pill ${
          JSON.stringify(a.pill)
        } over ${JSON.stringify(a.under)} (at rest ${JSON.stringify(rest)})`,
      );
      // it is still answerable: both answers are in the window
      await until("both answers are in view", async () => {
        const ok = await userPage.evaluate(() => {
          const inView = (s: string) => {
            const el = document.querySelector(s);
            if (!el) return false;
            const b = el.getBoundingClientRect();
            return b.left >= 0 && b.right <= innerWidth && b.top >= 0 &&
              b.bottom <= innerHeight && b.width > 0;
          };
          return inView("[data-cy='demo-end-confirm']") &&
            inView("[data-cy='demo-end-cancel']");
        });
        return ok ? null : "an answer is off-screen";
      }, 3_000);
    } finally {
      await userCtx.close();
    }
  }));

type Sample = { t: number; status: string; folded: boolean; box: number[] };

/** installed before the page loads: the pill's box every 100 ms on the page's own clock */
const recorder = () => {
  const w = globalThis as unknown as { __pill: Sample[] };
  w.__pill = [];
  setInterval(() => {
    const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
    if (!pill) return;
    const r = pill.getBoundingClientRect();
    w.__pill.push({
      t: performance.now(),
      status: pill.dataset.status ?? "",
      folded: pill.hasAttribute("data-tucked"),
      box: [r.left, r.top, r.width, r.height].map(Math.round),
    });
  }, 100);
};

Deno.test("REQ-866 (demo-loop cycle dm4, m2b) [es]: a first join on /customers at 1280×800 — the whole pill never covers 'Cerrar sesión' during the join grace", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const phone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, phone);
    await setMe(http, user.auth, "Ben Ortiz", "es");
    await answerQuestions(http, user.auth, {
      name: "Ben Ortiz",
      businessName: "Ben Ortiz Plumbing",
    });
    const admin = await verify(http, adminPhone);
    await setMe(http, admin.auth, "Alex from DocuMonster", "en");
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    expect.eq(boot.status, 200, "the admin phone is a super admin");
    await boot.body?.cancel();
    await useCookie(page.context(), baseUrl, admin.cookie, "en");

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    try {
      await userCtx.addInitScript(recorder);
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie, "es");
      await userPage.goto(`${baseUrl}/customers`);
      // an empty list (demo 4's "Aún no hay clientes"): a short page, the footer at the foot
      await userPage.getByText("Aún no hay clientes").first().waitFor({
        timeout: 30_000,
      });
      const logout = await userPage.evaluate(() => {
        const el = document.querySelector(".nav-item--logout");
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return [b.left, b.top, b.width, b.height].map(Math.round);
      });
      expect(logout !== null, "the sidebar shows Log out (.nav-item--logout)");
      await openDemo(page, baseUrl, phone);

      // a first join: the whole pill, for REQ-821's grace (5 s live), then it may fold
      await until("the customer's pill goes live, then 6 s pass", async () => {
        const s = await userPage.evaluate(() =>
          (globalThis as unknown as { __pill: Sample[] }).__pill
        );
        const live = s.find((p) => p.status === "live");
        if (!live) return `not live — last ${JSON.stringify(s.at(-1))}`;
        return s.at(-1)!.t - live.t > 6_000 ? null : "waiting";
      }, 40_000);
      await userPage.screenshot({ path: `${folder}/customers-after.png` });
      const s = await userPage.evaluate(() =>
        (globalThis as unknown as { __pill: Sample[] }).__pill
      );
      const t0 = s.find((p) => p.status === "live")!.t;
      const [lx, ly, lw, lh] = logout!;
      const over = s.filter((p) => {
        if (p.t < t0 || p.folded) return false;
        const [x, y, w, h] = p.box;
        return x < lx + lw && lx < x + w && y < ly + lh && ly < y + h;
      });
      const whole = s.filter((p) => p.t >= t0 && !p.folded);
      expect(
        whole.length >= 2,
        `sampled the whole pill during the grace — ${
          JSON.stringify(s.slice(-5))
        }`,
      );
      expect(
        over.length === 0,
        `the whole pill never covers Log out ${
          JSON.stringify(logout)
        } — ${over.length} samples over it, first ${JSON.stringify(over[0])}`,
      );
    } finally {
      await userCtx.close();
    }
  }));
