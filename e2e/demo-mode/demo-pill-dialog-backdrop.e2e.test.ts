/**
 * REQ-832 — demo-loop cycle dm2, issue p1 "Customer pill/folded chip covers page content
 * (composer, headings, footer, Log out) - re-check 9 NOT_FIXED". Raphael: "fix every issue the demo
 * found, loop until there are none".
 *
 * Demo 5 opened the send dialog at 1280×800 and the pill "jumps to the bottom-left and EXPANDS over
 * Log out": the overlay counted only the topmost element at each point — the dialog's full-screen
 * backdrop, which is neither page nor control — so every spot read clear. It now looks through the
 * backdrop: the pill (whole or folded) stays off Log out and off the dialog's panel.
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

/** a send dialog like the assistant's (assistant-page.css: the backdrop position:fixed; inset:0;
 *  background rgba(20,44,48,.45)), its panel centred, with a Send button */
const openDialog = () => {
  const back = document.createElement("div");
  back.id = "req832-backdrop";
  back.style.cssText =
    "position:fixed;inset:0;z-index:1000;background:rgba(20,44,48,.45);display:flex;align-items:center;justify-content:center";
  const panel = document.createElement("div");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.style.cssText =
    "width:480px;height:360px;background:#fff;border-radius:12px;padding:24px;box-sizing:border-box";
  panel.innerHTML =
    "<h2>Send quote</h2><p>Send this quote to the customer by email.</p><button type='button'>Send</button>";
  back.append(panel);
  document.body.append(back);
};

/** the pill's box (the mini-pill's when folded) and Log out's box */
const probe = () => {
  const box = (el: Element | null) => {
    const r = el?.getBoundingClientRect();
    return r && r.width > 0
      ? [r.left, r.top, r.right, r.bottom].map(Math.round)
      : null;
  };
  const tab = document.querySelector("[data-cy='demo-pill-tab']");
  const pill = box(tab ?? document.querySelector("[data-cy='demo-pill']"));
  const logout = box(document.querySelector(".nav-item--logout"));
  const panel = box(document.querySelector("#req832-backdrop [role=dialog]"));
  const hit = (a: number[] | null, b: number[] | null) =>
    !!a && !!b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  return {
    pill,
    logout,
    tucked: !!tab,
    overLogout: hit(pill, logout),
    overPanel: hit(pill, panel),
  };
};

Deno.test("REQ-832 (demo-loop cycle dm2, p1): with a send dialog open at 1280×800 the customer's demo pill and its folded chip stay off the sidebar's Log out under the backdrop", (t) =>
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
    await post(http, user.auth, "/api/customers", {
      name: "Customer 01",
      email: `c1-${digits()}@blackhole.postmarkapp.com`,
    });

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

      await userPage.goto(`${baseUrl}/customers`, { timeout: 120_000 });
      await userPage.locator("[data-cy='demo-pill'][data-status='live']")
        .waitFor({ state: "attached", timeout: 90_000 });
      await userPage.locator(".nav-item--logout").waitFor({ timeout: 15_000 });
      await userPage.evaluate(openDialog);
      try {
        await until(
          "1280×800 /customers, send dialog open: the pill is off Log out and off the dialog",
          async () => {
            const p = await userPage.evaluate(probe);
            return p.pill && !p.overLogout && !p.overPanel
              ? null
              : JSON.stringify(p);
          },
        );
      } catch (e) {
        await userPage.screenshot({ path: `${folder}/dialog.png` }).catch(
          () => {},
        );
        throw e;
      }
      // settled: still off it a few checks later (PILL_CHECK_MS)
      await userPage.waitForTimeout(2_000);
      const p = await userPage.evaluate(probe);
      await userPage.screenshot({ path: `${folder}/dialog.png` }).catch(
        () => {},
      );
      expect.eq(
        JSON.stringify({ overLogout: p.overLogout, overPanel: p.overPanel }),
        JSON.stringify({ overLogout: false, overPanel: false }),
        `send dialog open: the pill (${
          JSON.stringify(p.pill)
        }, tucked ${p.tucked}) is not over Log out (${
          JSON.stringify(p.logout)
        })`,
      );
    } finally {
      await userCtx.close();
    }
  }));
