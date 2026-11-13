/**
 * REQ-643 — demo-loop cycle 5, issues m9 "Empty beige strip under footer cuts content and stays
 * after demo ends" and p18-3d "Send modal dim layer doesn't cover the demo pill" (pair 3, a
 * 390×844 phone).
 *
 * A super admin opens a demo on a contractor who sits on /assistant on a 390×844 phone (the chat
 * shell, where the send dialog of pair 3 opens).
 *   1. Something of the page lands on the pill's home (a bottom bar with a button): the pill folds
 *      to its tab — and no room is reserved any more: --demo-pill-h and the body padding are gone
 *      and the app reaches the window's foot (no empty cream strip). The bar goes: the pill is home
 *      again, on its band.
 *   2. A dialog's backdrop opens inside the mobile .app (the send dialog's own class, so the app's
 *      CSS applies — the transformed .app holds it): every point of the window's bottom strip
 *      beside the pill is the backdrop or a band painted with the backdrop's dim, never a bright
 *      strip under a dimmed page.
 *   3. The stage ends the demo: while "… ended the demo" shows, no room is reserved (the app keeps
 *      its full height); before, the strip stayed until the notice was dismissed.
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
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out: ${what} — ${last}`);
}

/** the room reserved under the page, and where the app's shell ends (in the customer's page) */
const roomProbe = () => {
  const app = document.querySelector(".app")?.getBoundingClientRect() ?? null;
  const tab = document.querySelector("[data-cy='demo-pill-tab']");
  return {
    room: document.documentElement.style.getPropertyValue("--demo-pill-h"),
    pad: document.body.style.paddingBottom,
    appBottom: app ? Math.round(app.bottom) : null,
    vh: innerHeight,
    tab: tab !== null,
    pill: document.querySelector("[data-cy='demo-pill']") !== null,
  };
};

/** the window's bottom strip beside the pill: each point's topmost thing is the dialog's backdrop
 *  or a band painted with a dim — anything else is a bright strip under a dimmed page */
const strip = () => {
  const bd = document.querySelector<HTMLElement>("[data-cy='t-backdrop']");
  const band = document.querySelector<HTMLElement>("[data-cy='demo-band']");
  const pill = document.querySelector<HTMLElement>(
    "[data-cy='demo-pill'],[data-cy='demo-pill-tab']",
  );
  if (!bd) return ["no backdrop"];
  const p = pill?.getBoundingClientRect() ?? null;
  const was = band?.style.pointerEvents ?? "";
  if (band) band.style.pointerEvents = "auto";
  const bad: string[] = [];
  for (let i = 0; i <= 12; i++) {
    const x = 2 + ((innerWidth - 4) * i) / 12;
    for (const y of [innerHeight - 2, innerHeight - 20, innerHeight - 40]) {
      if (p && x >= p.left - 2 && x <= p.right + 2 && y >= p.top - 2) continue;
      const top = document.elementsFromPoint(x, y).find((n) =>
        n === band || !n.closest("[data-demo-overlay]")
      );
      if (top && (top === bd || bd.contains(top))) continue;
      if (top && top === band) {
        const img = getComputedStyle(band).backgroundImage;
        if (img.includes("gradient")) continue;
        bad.push(
          `(${Math.round(x)},${y}) the band, undimmed (${
            getComputedStyle(band).backgroundColor
          })`,
        );
        continue;
      }
      bad.push(
        `(${Math.round(x)},${y}) ${top?.tagName.toLowerCase() ?? "nothing"} "${
          (top?.textContent ?? "").trim().slice(0, 24)
        }"`,
      );
    }
  }
  if (band) band.style.pointerEvents = was;
  return [...new Set(bad)];
};

Deno.test("REQ-643 (demo-loop cycle 5, m9 + p18-3d): on a 390 px phone the pill's band is reserved only while the pill sits home on it — folded to its tab or showing the ended notice, no empty strip cuts the app — and a dialog's dim covers the band too", (t) =>
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
    expect.eq(boot.status, 200, "the admin phone is a super admin");
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      // a cold dev server builds the islands on the first load
      await userPage.goto(`${baseUrl}/assistant`, { timeout: 180_000 });

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
      await userPage.reload({ timeout: 120_000 });
      try {
        // a cold dev server builds the stage's and the overlay's modules on first use
        // connected (the status rides on the pill even while it is folded to its tab)
        await userPage.locator(
          "[data-cy='demo-pill'][data-status='live']",
        ).waitFor({ timeout: 90_000 });
      } catch (e) {
        await userPage.screenshot({
          path: `${folder}/phone-not-connected.png`,
        });
        throw e;
      }

      const home = async (what: string) =>
        await until(what, async () => {
          const r = await userPage.evaluate(roomProbe);
          return r.pill && !r.tab && r.room !== "" &&
              r.appBottom !== null && r.appBottom < r.vh - 20
            ? null
            : JSON.stringify(r);
        }, 15_000);
      await home("the pill is home on its band, the app ends above it");
      await userPage.screenshot({ path: `${folder}/phone-home.png` });

      // 1. m9 — the page under the home: the pill folds to its tab, and no strip is kept
      await userPage.evaluate(() => {
        const bar = document.createElement("div");
        bar.setAttribute("data-cy", "t-bar");
        bar.style.cssText =
          "position:fixed;left:0;right:0;bottom:0;height:120px;z-index:50;background:#fff;display:flex;align-items:flex-end;padding:8px";
        const b = document.createElement("button");
        b.textContent = "Save changes to this job";
        b.style.cssText = "width:100%;height:96px";
        bar.appendChild(b);
        document.body.appendChild(bar);
      });
      await until(
        "folded to its tab: no room reserved, the app down to the window's foot",
        async () => {
          const r = await userPage.evaluate(roomProbe);
          return r.tab && r.room === "" && r.pad === "" &&
              r.appBottom !== null && r.appBottom >= r.vh - 1
            ? null
            : JSON.stringify(r);
        },
      );
      await userPage.screenshot({ path: `${folder}/phone-tucked.png` });
      await userPage.evaluate(() =>
        document.querySelector("[data-cy='t-bar']")?.remove()
      );
      await home(
        "the page's foot clear again: the pill finds its home and band",
      );

      // 2. p18-3d — a dialog's backdrop inside the transformed mobile .app dims the band too
      await userPage.evaluate(() => {
        const app = document.querySelector(".app") ?? document.body;
        const bd = document.createElement("div");
        bd.className = "send-dialog__backdrop";
        bd.setAttribute("data-cy", "t-backdrop");
        const card = document.createElement("div");
        card.style.cssText =
          "background:#fff;width:240px;height:160px;border-radius:12px";
        card.textContent = "How do you want to send it?";
        bd.appendChild(card);
        app.appendChild(bd);
      });
      await until(
        "the window's bottom strip is dimmed with the page",
        async () => {
          const bad = await userPage.evaluate(strip);
          return bad.length === 0 ? null : bad.join(" | ");
        },
      );
      await userPage.screenshot({ path: `${folder}/phone-dialog.png` });
      await userPage.evaluate(() =>
        document.querySelector("[data-cy='t-backdrop']")?.remove()
      );
      await home("the dialog gone: home on its band again");

      // 3. m9 — a page whose document scrolls (the phone's /dashboard): at its top the cards run
      //    under the home, the pill is a tab and no room is kept (pair 1's strip); scrolled to its
      //    end, the end rises above the band and the pill sits home on it (REQ-379/545 as before)
      await userPage.goto(`${baseUrl}/dashboard`, { timeout: 120_000 });
      await userPage.locator("[data-cy='demo-pill'][data-status='live']")
        .waitFor({ timeout: 60_000 });
      await until(
        "/dashboard at its top: a tab, no room reserved",
        async () => {
          const r = await userPage.evaluate(roomProbe);
          return r.tab && r.room === "" && r.pad === ""
            ? null
            : JSON.stringify(r);
        },
      );
      await userPage.evaluate(() => {
        const d = document.scrollingElement!;
        d.scrollTop = d.scrollHeight;
      });
      await until(
        "/dashboard scrolled to its end: home on its band, the end above it",
        async () => {
          const r = await userPage.evaluate(() => {
            const d = document.scrollingElement!;
            return {
              room: document.documentElement.style.getPropertyValue(
                "--demo-pill-h",
              ),
              tab: document.querySelector("[data-cy='demo-pill-tab']") !== null,
              atEnd: d.scrollTop + d.clientHeight >= d.scrollHeight - 2,
            };
          });
          return !r.tab && r.room !== "" && r.atEnd ? null : JSON.stringify(r);
        },
        15_000,
      );
      await userPage.screenshot({ path: `${folder}/phone-dashboard-end.png` });

      // 4. m9 — the stage ends it: the notice shows, and no room is kept under the page
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      await userPage.locator("[data-cy='demo-ended']").waitFor({
        timeout: 15_000,
      });
      await until(
        "while the ended notice shows, the app has its full height back",
        async () => {
          const r = await userPage.evaluate(roomProbe);
          return r.room === "" && r.pad === "" && r.appBottom !== null &&
              r.appBottom >= r.vh - 1
            ? null
            : JSON.stringify(r);
        },
      );
      await userPage.screenshot({ path: `${folder}/phone-ended.png` });
    } finally {
      await userCtx.close();
    }
  }));
