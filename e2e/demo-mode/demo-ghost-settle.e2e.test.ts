/**
 * REQ-789 AMENDMENT 2 (demo-loop run 15, m3; by hand) — the presenter's mouse rests on the stage
 * over a field of the customer's /settings (1024×768, ES); the customer smooth-scrolls the page
 * under it, so her arrow rides the field up over ~400 ms. The stage's ghost of his arrow is drawn
 * from her reports: REQ-789 AMENDMENT restarted its fade at every moved spot, which BLINKED it
 * (opacity 0.24 → 0 → 0.2 → 0 → 0.5) at three spots on the way. A fade restarted by a move now
 * waits GHOST_SETTLE_MS unseen first, and a move within that wait starts it over: the ghost fades
 * in once, where the arrow has settled — no frame of it on the way, no drop back to 0.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const CUSTOMER = { width: 1024, height: 768 };

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
  if (!cookie) throw new Error("sign-in: no session cookie");
  return { body, cookie, auth: { ...JSON_HEADERS, cookie } };
}
// deno-lint-ignore no-explicit-any
async function useCookie(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "es", domain, path: "/" },
  ]));
}

type GhostSample = {
  at: number;
  g: { x: number; y: number; op: number } | null;
  cust: number | null;
};

Deno.test("REQ-789 AMENDMENT 2 (demo-loop run 15, m3): his mouse rests over a /settings field; she smooth-scrolls 200 px — the ghost of his arrow fades in ONCE where it settles: no frame of it on the way (> 8 px off), no drop back towards 0 once it has begun", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "es", name: "Maria Lopez" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Maria Lopez",
      businessName: "Lopez Roofing",
    });
    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      body: JSON.stringify({ language: "es", name: "Alex" }),
    })).body?.cancel();
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    await boot.body?.cancel();
    expect.eq(boot.status, 200, "Alex is a super admin");
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({ viewport: CUSTOMER });
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await tab.goto(`${baseUrl}/settings?lang=es`);
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto(`${baseUrl}/admin?lang=es`);
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.waitForURL((u: URL) => u.pathname === "/demo/stage", {
        timeout: 25_000,
      });
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*En vivo\s*$/,
      }).waitFor({ timeout: 25_000 });
      await tab.waitForTimeout(1_500);
      const frame = await page.evaluate(() => {
        const r = document.querySelector("[data-cy='demo-frame']")
          ?.getBoundingClientRect();
        return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      });
      if (!frame) throw new Error("no frame on the stage");
      // a field of hers in view, below the fold's first rows
      const field = await tab.evaluate(() => {
        const els = Array.from(
          document.querySelectorAll<HTMLElement>("input, textarea, select"),
        );
        const e = els.filter((i) => {
          const r = i.getBoundingClientRect();
          return r.top > 60 && r.bottom < 700 && r.width > 80;
        })[0];
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (!field) throw new Error("no field of hers in view");
      const sx = frame.w / CUSTOMER.width, sy = frame.h / CUSTOMER.height;
      const px = frame.x + field.x * sx, py = frame.y + field.y * sy;
      // his mouse comes to rest over the field
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(px - 200 + i * 25, py + 40 - i * 5);
      }
      await page.mouse.move(px, py);
      await page.waitForTimeout(1_500);
      // she smooth-scrolls; the stage's ghost is sampled every ~15 ms for 2 s
      const samples: GhostSample[] = [];
      const t0 = Date.now();
      const run = (async () => {
        while (Date.now() - t0 < 2_000) {
          const g = await page.evaluate(() => {
            const el = document.querySelector<HTMLElement>(
              "[data-cy='demo-pointer-ghost']",
            );
            if (!el) return null;
            const cs = getComputedStyle(el);
            const m = new DOMMatrixReadOnly(cs.transform);
            return { x: Math.round(m.e), y: Math.round(m.f), op: Number(cs.opacity) };
          }).catch(() => null);
          const cust = await tab.evaluate(() => {
            const el = document.querySelector<HTMLElement>("[data-cy='demo-pointer']");
            if (!el) return null;
            return Math.round(new DOMMatrixReadOnly(getComputedStyle(el).transform).f);
          }).catch(() => null);
          samples.push({ at: Date.now() - t0, g, cust });
          await page.waitForTimeout(15);
        }
      })();
      await tab.evaluate(() => {
        const c = document.querySelector<HTMLElement>(".content") ??
          (document.scrollingElement as HTMLElement);
        c.scrollBy({ top: 200, behavior: "smooth" });
      });
      await run;
      await page.screenshot({ path: `${folder}/ghost-after-scroll.png` });
      const shown = samples.filter((s) => s.g && s.g.op > 0.05);
      expect(shown.length > 0, `the ghost appeared after her scroll (${samples.length} samples)`);
      const final = shown[shown.length - 1];
      const astray = shown.filter((s) => Math.abs(s.g!.y - final.g!.y) > 8);
      let blinks = 0;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1].g, b = samples[i].g;
        if (a && b && a.op > 0.1 && b.op < a.op - 0.1) blinks++;
      }
      expect(
        astray.length === 0 && blinks === 0,
        `m3: one fade-in where it settles (y ${final.g!.y}) — ${astray.length} frame(s) on the way (${
          JSON.stringify(astray.slice(0, 4))
        }), ${blinks} drop(s) back`,
      );
    } finally {
      await userCtx.close();
    }
  }));
