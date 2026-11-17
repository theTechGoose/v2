/**
 * REQ-897 — demo-loop run 6 (dm6), issues p4 + p5 (amends REQ-853 / REQ-781 / REQ-818).
 *
 * p4: at 390×844 in Spanish the folded "Demo ×" chip (0,644 96×32) sat over the start of the
 *     dashboard's "Termina la configuración — faltan 5 cosas" heading ("Term" hidden). With text
 *     under every tab spot the chip took the FIRST control-free spot; now it takes the one with the
 *     least of the page under it, and a heading weighs more than a line of text.
 * p5: scrolling /settings at 390 px the chip hopped edge to edge as text came and went under it.
 *     While the page scrolls the chip holds its spot (a field sits in every row there) and is
 *     judged against what is under it once the scroll has settled.
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
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out: ${what} — ${last}`);
}

/** runs in every page of the customer's tab from its first byte: the chip's box, every frame
 *  (only its changes are kept) */
const SAMPLER = `(() => {
  try { localStorage.setItem("pm:assistant-coachmark-shown", "1"); } catch {}
  const log = [];
  window.__chipLog = log;
  const t0 = performance.now();
  const tick = () => {
    const el = document.querySelector("[data-cy='demo-pill-tab']");
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) {
        const at = Math.round(r.left) + "," + Math.round(r.top);
        if (!log.length || log[log.length - 1].at !== at) {
          log.push({ t: Math.round(performance.now() - t0), at });
        }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

type Box = { left: number; top: number; right: number; bottom: number };

/** the chip's box and the visible headings / controls it overlaps */
const probe = () => {
  const box = (el: Element | null): Box | null => {
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0
      ? {
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
      }
      : null;
  };
  const meets = (a: Box, b: Box) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom &&
    b.top < a.bottom;
  const chip = box(document.querySelector("[data-cy='demo-pill-tab']"));
  const overlapping = (sel: string) =>
    chip
      ? [...document.querySelectorAll(sel)]
        .filter((el) => !el.closest("[data-demo-overlay]"))
        .map((el) => ({ el, b: box(el) }))
        .filter((x) => x.b && meets(chip, x.b))
        .map((x) =>
          `${x.el.tagName.toLowerCase()} "${
            (x.el.textContent ?? "").trim().slice(0, 40)
          }" ${JSON.stringify(x.b)}`
        )
      : [];
  return {
    chip,
    headings: overlapping("h1,h2,h3,[role='heading']"),
    controls: overlapping(
      "a[href],button,input,select,textarea,[role='button'],[role='link']",
    ),
    headingText: [...document.querySelectorAll("h1,h2,h3")]
      .map((el) => (el.textContent ?? "").trim())
      .find((x) => /faltan|Termina/.test(x)) ?? null,
  };
};

Deno.test("REQ-897 (demo-loop cycle dm6, p4 + p5): at 390×844 in Spanish the folded demo chip is off the dashboard's setup heading, and holds its spot through a scroll of /settings", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "es", name: "Maria Castro" }),
    })).body?.cancel();
    // the demo accounts' dashboard: five setup items left (skipped in the wizard, REQ-227), so the
    // checklist's heading "Termina la configuración — faltan 5 cosas" is on the dashboard
    const skipped = [
      "logo",
      "address",
      "payment",
      "insurance",
      "email",
    ] as const;
    await answerQuestions(http, user.auth, {
      name: "Maria Castro",
      businessName: "Castro Painting",
      except: [...skipped],
    });
    for (const question of skipped) {
      const r = await http("/api/me/onboarding/deferred", {
        method: "POST",
        headers: user.auth,
        body: JSON.stringify({ question }),
      });
      if (!r.ok) throw new Error(`defer ${question}: ${r.status}`);
      await r.body?.cancel();
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
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await userCtx.addInitScript(SAMPLER);
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie, "es");
      // a cold dev server builds the islands on the first load
      await userPage.goto(`${baseUrl}/dashboard`, { timeout: 180_000 });

      await useCookie(page.context(), baseUrl, admin.cookie, "en");
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

      // p4 — /dashboard: the chip, once folded, is off the setup heading
      await userPage.goto(`${baseUrl}/dashboard`, { timeout: 120_000 });
      await userPage.locator("[data-cy='demo-pill'][data-status='live']")
        .waitFor({ state: "attached", timeout: 90_000 });
      await userPage.locator("[data-cy='demo-pill-tab']").waitFor({
        state: "attached",
        timeout: 60_000,
      });
      await until("/dashboard ES: the chip is drawn", async () => {
        const p = await userPage.evaluate(probe);
        return p.chip ? null : JSON.stringify(p);
      });
      // settled: a check later (PILL_CHECK_MS)
      await userPage.waitForTimeout(1_500);
      const dash = await userPage.evaluate(probe);
      await userPage.screenshot({ path: `${folder}/dashboard-es.png` }).catch(
        () => {},
      );
      expect.eq(
        /faltan|Termina/.test(dash.headingText ?? ""),
        true,
        `the setup checklist's heading is on the dashboard (saw ${
          JSON.stringify(dash.headingText)
        })`,
      );
      expect.eq(
        dash.headings.length,
        0,
        `p4: /dashboard ES at 390×844 — the folded chip ${
          JSON.stringify(dash.chip)
        } covers no heading (over: ${JSON.stringify(dash.headings)})`,
      );
      expect.eq(
        dash.controls.length,
        0,
        `p4: the chip covers no control either (over: ${
          JSON.stringify(dash.controls)
        })`,
      );

      // p5 — /settings: a continuous scroll (a finger's flick's worth of wheel events, 30 ms apart)
      await userPage.goto(`${baseUrl}/settings`, { timeout: 120_000 });
      await userPage.locator("[data-cy='demo-pill-tab']").waitFor({
        state: "attached",
        timeout: 60_000,
      });
      // the page's own settling first (its data arriving moves the chip, REQ-853): quiet for 2 s
      await until("/settings: the chip has come to rest", async () => {
        const q = await userPage.evaluate(() => {
          // deno-lint-ignore no-explicit-any
          const log = (globalThis as any).__chipLog as { t: number }[];
          const last = log[log.length - 1];
          return last ? performance.now() - last.t : 0;
        });
        return q >= 2_000 ? null : `moved ${Math.round(q)} ms ago`;
      }, 30_000);
      const before = await userPage.evaluate(() =>
        // deno-lint-ignore no-explicit-any
        ((globalThis as any).__chipLog as { t: number; at: string }[]).length
      );
      // a finger's flick: the page scrolled from inside, a step per frame for a second (a wheel
      // event per round trip from here is spaced by the host's load — past PILL_SCROLL_SETTLE_MS
      // under a parallel lane, which is a settled scroll, not this one)
      await userPage.evaluate(() =>
        new Promise<void>((done) => {
          const t0 = performance.now();
          const step = () => {
            scrollBy(0, 20);
            if (performance.now() - t0 < 1_000) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        })
      );
      const during = await userPage.evaluate((n) =>
        // deno-lint-ignore no-explicit-any
        ((globalThis as any).__chipLog as { t: number; at: string }[]).slice(n)
          .map((e) => e.at), before);
      // settled (PILL_SCROLL_SETTLE_MS, then the final place and its glide)
      await userPage.waitForTimeout(1_500);
      const after = await userPage.evaluate(probe);
      const log = await userPage.evaluate(() =>
        // deno-lint-ignore no-explicit-any
        (globalThis as any).__chipLog as { t: number; at: string }[]
      );
      await userPage.screenshot({ path: `${folder}/settings-scrolled.png` })
        .catch(() => {});
      await Deno.writeTextFile(
        `${folder}/chip-log.json`,
        JSON.stringify({ dash, during, after, log }),
      );
      expect.eq(
        during.length,
        0,
        `p5: through a scroll of /settings the chip holds its spot — moved ${
          JSON.stringify(during)
        }`,
      );
      expect.eq(
        after.controls.length,
        0,
        `p5: settled, the chip ${
          JSON.stringify(after.chip)
        } covers no control (over: ${JSON.stringify(after.controls)})`,
      );
    } finally {
      await userCtx.close();
    }
  }));
