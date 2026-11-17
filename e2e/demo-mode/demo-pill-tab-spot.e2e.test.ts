/**
 * REQ-853 — demo-loop cycle dm3, issues p1 + p8. Raphael: "fix every issue the demo found, loop
 * until there are none".
 *
 * p1: on /clients at 1280×800 in Spanish the folded "Demo ×" chip (1184–1280 × 760–792) sat over
 *     the compact footer's address ("…, SC 29588" ends at x 1251) — a page that cannot scroll, so it
 *     stayed covered for good. The chip now avoids text: it never overlaps [data-site-address].
 * p8: the chip jumped 1184,760 → 1184,680 about 0.7 s after /dashboard loaded (the first place()
 *     saw the loading skeleton; the next waited for the 700 ms poll). After a reload of /dashboard
 *     the chip, once drawn, stays where it first appeared.
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
  // the assistant coachmark's dim would sit over the dashboard (a demo customer has seen it)
  try { localStorage.setItem("pm:assistant-coachmark-shown", "1"); } catch {}
  // how many times the page was measured (a placement samples it with elementsFromPoint in one
  // synchronous burst: one count per burst)
  const efp = document.elementsFromPoint.bind(document);
  let burst = false;
  window.__measures = 0;
  document.elementsFromPoint = (x, y) => {
    if (!burst) {
      burst = true;
      window.__measures++;
      queueMicrotask(() => { burst = false; });
    }
    return efp(x, y);
  };
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

/** the chip's (or whole pill's) box and the footer address's box */
const probe = () => {
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
  const pill = box(
    document.querySelector("[data-cy='demo-pill-tab']") ??
      document.querySelector("[data-cy='demo-pill']"),
  );
  const address = box(document.querySelector("[data-site-address]"));
  const overAddress = !!pill && !!address && pill.left < address.right &&
    address.left < pill.right && pill.top < address.bottom &&
    address.top < pill.bottom;
  return {
    pill,
    address,
    tucked: !!document.querySelector("[data-cy='demo-pill-tab']"),
    overAddress,
  };
};

Deno.test("REQ-853 (demo-loop cycle dm3, p1 + p8): at 1280×800 in Spanish the folded demo chip is off the footer's address on /clients, and stays put after a /dashboard reload", (t) =>
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
    if (boot.status !== 200) throw new Error(`bootstrap → ${boot.status}`);
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await userCtx.addInitScript(SAMPLER);
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie, "es");
      // a cold dev server builds the islands on the first load
      await userPage.goto(`${baseUrl}/clients`, { timeout: 180_000 });

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

      // p1 — /clients: the chip folds off the footer's address line
      await userPage.goto(`${baseUrl}/clients`, { timeout: 120_000 });
      await userPage.locator("[data-cy='demo-pill'][data-status='live']")
        .waitFor({ state: "attached", timeout: 90_000 });
      await userPage.locator("[data-site-address]").waitFor({
        timeout: 15_000,
      });
      try {
        await until("/clients ES: the pill is drawn", async () => {
          const p = await userPage.evaluate(probe);
          return p.pill ? null : JSON.stringify(p);
        });
      } catch (e) {
        await userPage.screenshot({ path: `${folder}/clients-es.png` }).catch(
          () => {},
        );
        throw e;
      }
      // settled: a check later (PILL_CHECK_MS)
      await userPage.waitForTimeout(1_500);
      const p = await userPage.evaluate(probe);
      await userPage.screenshot({ path: `${folder}/clients-es.png` }).catch(
        () => {},
      );
      expect.eq(
        p.overAddress,
        false,
        `p1: /clients ES at 1280×800 — the pill (${
          JSON.stringify(p.pill)
        }, tucked ${p.tucked}) is not over the footer address (${
          JSON.stringify(p.address)
        })`,
      );

      // now a dashboard with something on it (demo 2's had data): customers and quotes, some sent.
      // (Seeded after /clients: demo 3's list was short enough that /clients could not scroll)
      for (let i = 1; i <= 4; i++) {
        const c = await post(http, user.auth, "/api/customers", {
          name: `Cliente ${i} Hansen`,
          email: `c${i}-${digits()}@blackhole.postmarkapp.com`,
          address: `${100 + i} Frederick Rd, Rockingham, VA`,
        });
        const quote = await post(http, user.auth, "/api/quotes", {
          customerId: c.id,
          summary: `Pintura exterior ${i}`,
          jobName: `Pintura ${i}`,
          description: "Lijar, imprimar y pintar la fachada.",
          lineItems: [
            {
              description: "Mano de obra",
              quantity: 1,
              unit: "job",
              price: 30000,
            },
          ],
          estimatedTotal: 30000,
          status: "draft",
        });
        if (i % 2) {
          await (await http(`/api/quotes/${quote.id}`, {
            method: "PUT",
            headers: user.auth,
            body: JSON.stringify({ status: "sent" }),
          })).body?.cancel();
        }
      }

      // p8 — /dashboard: settle once, then reload; the chip, once drawn, never moves
      await userPage.goto(`${baseUrl}/dashboard`, { timeout: 120_000 });
      await userPage.locator("[data-cy='demo-pill'][data-status='live']")
        .waitFor({ state: "attached", timeout: 90_000 });
      await userPage.waitForTimeout(2_500);
      await userPage.reload({ timeout: 120_000 });
      await userPage.locator("[data-cy='demo-pill']").waitFor({
        state: "attached",
        timeout: 90_000,
      });
      await userPage.waitForTimeout(3_000);
      const log = await userPage.evaluate(() =>
        // deno-lint-ignore no-explicit-any
        (globalThis as any).__chipLog as { t: number; at: string }[]
      );
      await userPage.screenshot({ path: `${folder}/dashboard-reload.png` })
        .catch(() => {});
      const final = await userPage.evaluate(probe);
      await Deno.writeTextFile(
        `${folder}/chip-log.json`,
        JSON.stringify({ log, final }),
      );
      expect.eq(
        log.length <= 1,
        true,
        `p8: after a /dashboard reload the chip stays where it first appeared — seen ${
          JSON.stringify(log)
        } (final ${JSON.stringify(final.pill)}, tucked ${final.tucked})`,
      );

      // the page observers never feed themselves: an idle page is measured at the poll's pace
      // (PILL_CHECK_MS), not every frame
      const idle = await userPage.evaluate(async () => {
        // deno-lint-ignore no-explicit-any
        const w = globalThis as any;
        const a = w.__measures;
        await new Promise((r) => setTimeout(r, 3_000));
        return w.__measures - a;
      });
      expect.eq(
        idle <= 10,
        true,
        `an idle /dashboard is measured about once a poll (≤ 10 times in 3 s), got ${idle}`,
      );

      // p8 — the page changes under the chip (a control drawn where it sits, as the dashboard's data
      // replaces its skeleton): it moves off within a frame or two, not at the next 700 ms poll
      const moves: { ms: number; frames: number }[] = [];
      for (let i = 0; i < 5; i++) {
        const move = await userPage.evaluate(() =>
          new Promise<{ ms: number; frames: number }>((done) => {
            const chip = document.querySelector("[data-cy='demo-pill-tab']");
            if (!chip) return done({ ms: -1, frames: -1 });
            const r0 = chip.getBoundingClientRect();
            document.getElementById("req853-blocker")?.remove();
            const b = document.createElement("button");
            b.id = "req853-blocker";
            b.type = "button";
            b.textContent = "Ver";
            b.style.cssText =
              `position:fixed;left:${r0.left}px;top:${r0.top}px;width:${r0.width}px;height:${r0.height}px;z-index:2147483000;pointer-events:auto`;
            const t0 = performance.now();
            let frames = 0;
            document.body.append(b);
            const tick = () => {
              frames++;
              const el = document.querySelector("[data-cy='demo-pill-tab']") ??
                document.querySelector("[data-cy='demo-pill']");
              const r = el?.getBoundingClientRect();
              if (!r || r.left !== r0.left || r.top !== r0.top) {
                return done({ ms: Math.round(performance.now() - t0), frames });
              }
              if (performance.now() - t0 > 3_000) {
                return done({ ms: 9_999, frames });
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          })
        );
        moves.push(move);
        await userPage.waitForTimeout(1_200);
      }
      await Deno.writeTextFile(
        `${folder}/moves.json`,
        JSON.stringify({ moves, idle }),
      );
      expect.eq(
        moves.every((m) => m.frames >= 1 && m.frames <= 3),
        true,
        `p8: a control drawn under the chip moves it off within 3 frames (not at the 700 ms poll) — took ${
          JSON.stringify(moves)
        }`,
      );
    } finally {
      await userCtx.close();
    }
  }));
