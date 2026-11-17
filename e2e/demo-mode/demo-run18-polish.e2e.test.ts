/**
 * Demo-loop run 18 (by hand) — the customer's End answers, and the presenter's /admin after End.
 *  m1 — REQ-235 AMENDMENT: the folded tab's × asked, and the FIRST click on "Sí, terminar" did
 *       nothing: Yes waits END_ARM_MS after the question (so a double click on End never ends a
 *       demo), measured from the question's effect — ~480 ms after the × click — while the
 *       answer sat 820 px from the ×, where no double click could land. Yes arms at once when the
 *       press that asked is not on it.
 *  m2 — REQ-890 AMENDMENT 6 REVISION 2: a peek opened under the approaching mouse, End under it;
 *       the mouse rested a full second on End and the click was still "the tab's" (nothing
 *       visible happened). An approach is over once the pointer has rested PEEK_APPROACH_REST_MS
 *       on its spot: the click then is End's.
 *  p2 — REQ-908 AMENDMENT: after End, /admin painted the generic sidebar (no Admin, no name) for
 *       ~350 ms — the tab's dash cache was cleared when the impersonation ended, and the sidebar
 *       waited for /me. /admin seeds the sidebar from the session it rendered for.
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
  if (!cookie) throw new Error("sign-in: no session cookie");
  return { body, cookie, auth: { ...JSON_HEADERS, cookie } };
}
async function useCookie(
  // deno-lint-ignore no-explicit-any
  ctx: any,
  baseUrl: string,
  cookie: string,
  lang: "en" | "es",
) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: lang, domain, path: "/" },
  ]));
}

/** Maria (onboarded) on `path` in her own window; Alex on /admin, the demo on, her pill folded */
async function setUp(
  // deno-lint-ignore no-explicit-any
  page: any,
  http: StoryTools["http"],
  baseUrl: string,
  path: string,
  lang: "en" | "es",
  viewport: { width: number; height: number },
) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: lang, name: "Maria Lopez" }),
  })).body?.cancel();
  await answerQuestions(http, user.auth, {
    name: "Maria Lopez",
    businessName: "Lopez Roofing",
  });
  const admin = await verify(http, adminPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: lang, name: "Alex Rivera" }),
  })).body?.cancel();
  const boot = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: adminPhone }),
  });
  await boot.body?.cancel();
  if (boot.status !== 200) throw new Error(`bootstrap: ${boot.status}`);
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser behind the story page");
  const userCtx = await browser.newContext({ viewport });
  const tab = await userCtx.newPage();
  await useCookie(userCtx, baseUrl, user.cookie, lang);
  await tab.goto(`${baseUrl}${path}?lang=${lang}`);
  await useCookie(page.context(), baseUrl, admin.cookie, lang);
  await page.goto(`${baseUrl}/admin?lang=${lang}`);
  await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
  await page.locator("[data-cy='adm-search']").click();
  await page.locator("[data-cy='adm-demo']").first().waitFor({
    timeout: 15_000,
  });
  await page.locator("[data-cy='adm-demo']").first().click();
  await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
  await tab.locator("[data-cy='demo-pill']").waitFor({ timeout: 20_000 });
  await tab.locator("[data-cy='demo-pill'][data-tucked]").waitFor({
    timeout: 30_000,
  });
  await tab.waitForTimeout(500);
  return { userCtx, tab };
}

const state = ([x, y]: [number, number]) => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  const r = pill?.getBoundingClientRect();
  const e = document.elementFromPoint(x, y) as HTMLElement | null;
  const b = e?.closest("button");
  const det = document.querySelector<HTMLElement>("[data-cy='demo-details']");
  const yes = document.querySelector<HTMLButtonElement>(
    "[data-cy='demo-end-confirm']",
  );
  return {
    box: r ? [r.left, r.top, r.width, r.height].map(Math.round) : null,
    tucked: pill?.hasAttribute("data-tucked") ?? null,
    peek: pill?.hasAttribute("data-peek") ?? null,
    under: b
      ? (b.getAttribute("data-cy") ?? b.textContent?.trim())
      : (e?.getAttribute("data-cy") ?? e?.tagName ?? null),
    asking: !!document.querySelector("[data-cy='demo-end-ask']"),
    yesDisabled: yes ? yes.disabled : null,
    more: document.querySelector("[data-cy='demo-more']")?.getAttribute(
      "aria-expanded",
    ) ?? null,
    details: det ? getComputedStyle(det).display !== "none" : false,
    text: (pill?.innerText ?? "").replace(/\s+/g, " ").slice(0, 90),
  };
};

Deno.test("REQ-235 AMENDMENT (demo-loop run 18, m1): 1280×800, ES /dashboard — the folded tab's × asks; Sí sits far from the ×, so it counts at once: a click on it 400 ms after the × ends the demo", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx, tab } = await setUp(page, http, baseUrl, "/dashboard", "es", {
      width: 1280,
      height: 800,
    });
    try {
      const tb = (await tab.evaluate(state, [0, 0] as [number, number])).box!;
      const x = await tab.locator("[data-cy='demo-pill-tab-end']").boundingBox();
      if (!x) throw new Error("no tab ×: " + JSON.stringify(tb));
      const xc: [number, number] = [x.x + x.width / 2, x.y + x.height / 2];
      const log: unknown[] = [];
      const t0 = Date.now();
      let on = true;
      let pt: [number, number] = xc;
      const sampler = (async () => {
        while (on) {
          log.push({ at: Date.now() - t0, pt, ...(await tab.evaluate(state, pt)) });
          await tab.waitForTimeout(25);
        }
      })();
      await tab.mouse.move(xc[0], xc[1] + 120);
      await tab.mouse.move(xc[0], xc[1], { steps: 3 });
      await tab.waitForTimeout(200);
      await tab.mouse.down();
      await tab.mouse.up();
      const tClick1 = Date.now() - t0;
      await tab.locator("[data-cy='demo-end-ask']").waitFor({ timeout: 5_000 });
      await tab.waitForTimeout(100);
      const yes = await tab.locator("[data-cy='demo-end-confirm']").boundingBox();
      if (!yes) throw new Error("no Sí: " + JSON.stringify(log.slice(-2)));
      const far = Math.hypot(yes.x + yes.width / 2 - xc[0], yes.y + yes.height / 2 - xc[1]);
      expect(far > 100, `Sí is far from the × that asked (${Math.round(far)} px)`);
      pt = [yes.x + yes.width / 2, yes.y + yes.height / 2];
      await tab.mouse.move(pt[0], pt[1], { steps: 2 });
      // the tester's click: ~400 ms after the ×, the mouse just arrived
      const since = Date.now() - t0 - tClick1;
      if (since < 380) await tab.waitForTimeout(380 - since);
      await tab.mouse.down();
      await tab.mouse.up();
      const tClick2 = Date.now() - t0;
      await tab.waitForTimeout(1_500);
      on = false;
      await sampler;
      const after = await tab.evaluate(state, pt);
      const stage = (await page.locator("[data-cy='demo-status']").innerText().catch(() => "?")).trim();
      await Deno.writeTextFile(
        `${folder}/m1-samples.json`,
        JSON.stringify({ tb, xc, tClick1, tClick2, far, after, stage, log }, null, 1),
      );
      await tab.screenshot({ path: `${folder}/m1-after.png` });
      expect(
        tClick2 - tClick1 < 480,
        `the click on Sí came within 480 ms of the × (${tClick2 - tClick1} ms)`,
      );
      expect(
        !after.asking && !/En vivo|Live/.test(stage),
        `m1: the first Sí click ends the demo (after=${JSON.stringify(after)}, stage=${stage}, clicks at ${tClick1}/${tClick2} ms)`,
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-890 AMENDMENT 6 REVISION 2 (demo-loop run 18, m2): 1024×768, EN /dashboard — the peek opens under the approaching mouse, End under it; a click after a 1 s rest on End is End's (the question), a click right after arriving is still the tab's", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx, tab } = await setUp(page, http, baseUrl, "/dashboard", "en", {
      width: 1024,
      height: 768,
    });
    try {
      const tb = (await tab.evaluate(state, [0, 0] as [number, number])).box!;
      const c: [number, number] = [tb[0] + tb[2] / 2, tb[1] + tb[3] / 2];
      await tab.mouse.move(c[0], c[1] + 120);
      await tab.mouse.move(c[0], c[1], { steps: 5 });
      await tab.waitForTimeout(700);
      const opened = await tab.evaluate(state, c);
      expect(opened.peek === true, `the peek opened under the mouse (${JSON.stringify(opened)})`);
      // a dry run told where End sits on the peek this approach opens; away again, the pill folds
      const end = await tab.locator("[data-cy='demo-end']").boundingBox();
      if (!end) throw new Error("no End on the peek");
      const e: [number, number] = [end.x + end.width / 2, end.y + end.height / 2];
      // away (inside the window — a pointer gone off it says nothing): the peek closes
      await tab.mouse.move(Math.max(60, c[0] - 300), Math.max(60, c[1] - 250), {
        steps: 3,
      });
      await tab.locator("[data-cy='demo-pill'][data-tucked]").waitFor({
        timeout: 10_000,
      });
      await tab.waitForTimeout(500);
      // the tester's approach: five continuous steps that END on End's spot (inside the tab's
      // box), the peek opening under them — the approach's own `at` is End's centre
      await tab.mouse.move(e[0], e[1] + 120);
      await tab.mouse.move(e[0], e[1], { steps: 5 });
      await tab.waitForTimeout(100);
      const arrived = await tab.evaluate(state, e);
      // a full second resting on End, then the click: End's (the quick click on arrival is the
      // tab's — REQ-890 AMENDMENT 6's own story)
      await tab.waitForTimeout(1_100);
      const before = await tab.evaluate(state, e);
      await tab.mouse.down();
      await tab.mouse.up();
      await tab.waitForTimeout(400);
      const rested = await tab.evaluate(state, e);
      await tab.screenshot({ path: `${folder}/m2-rested-click.png` });
      await Deno.writeTextFile(
        `${folder}/m2-samples.json`,
        JSON.stringify({ tb, c, e, opened, arrived, before, rested }, null, 1),
      );
      expect(
        arrived.peek === true && arrived.under === "demo-end",
        `the approach opened the peek with End under the mouse (${JSON.stringify(arrived)})`,
      );
      expect(before.under === "demo-end", `End was under the resting mouse (${JSON.stringify(before)})`);
      expect(
        rested.asking,
        `m2: the click after a 1 s rest on End asks (${JSON.stringify(rested)})`,
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-908 AMENDMENT (demo-loop run 18, p2): after End the presenter's /admin shows the Admin tab and his name from its first paint, with /me held back 2 s", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx } = await setUp(page, http, baseUrl, "/dashboard", "es", {
      width: 1280,
      height: 800,
    });
    try {
      // the sidebar's own fetches are held: what shows is what the page came with
      await page.route(/\/api\/(me|profile)(\?|$)/, async (route: { request(): { method(): string }; continue(): Promise<void> }) => {
        if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 2_000));
        await route.continue().catch(() => {});
      });
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      await page.waitForURL((u: URL) => u.pathname === "/admin", { timeout: 25_000 });
      const samples: { at: number; admin: boolean; name: boolean; nav: string }[] = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 1_200) {
        const s = await page.evaluate(() => {
          const sb = document.querySelector(".sb__nav");
          return {
            admin: !!document.querySelector(".sb__nav a[href='/admin']"),
            name: /Alex Rivera|Alex/.test(document.querySelector(".sb, aside, nav")?.textContent ?? ""),
            nav: (sb?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
          };
        }).catch(() => null);
        if (!s) break;
        samples.push({ at: Date.now() - t0, ...s });
        await page.waitForTimeout(50);
      }
      await page.screenshot({ path: `${folder}/admin-after-end.png` });
      await Deno.writeTextFile(`${folder}/admin-sidebar-samples.json`, JSON.stringify(samples, null, 1));
      const withNav = samples.filter((s) => s.nav.length > 0);
      expect(withNav.length > 0, `the sidebar was sampled (${samples.length} samples)`);
      const noAdmin = withNav.filter((s) => !s.admin);
      expect(
        noAdmin.length === 0,
        `p2: every painted sidebar has the Admin tab (${noAdmin.length} of ${withNav.length} without: ${JSON.stringify(noAdmin.slice(0, 3))})`,
      );
      const noName = withNav.filter((s) => !s.name);
      expect(
        noName.length === 0,
        `p2: every painted sidebar names the presenter (${noName.length} of ${withNav.length} without)`,
      );
    } finally {
      await userCtx.close();
    }
  }));
