/**
 * Demo-loop run 19 (by hand) — the stage's off ghost, the customer's question's first frames, and
 * the stage's word for a new tab.
 *  m2 — REQ-877 AMENDMENT: while the presenter's mouse moved beside the frame, the stage's ghost
 *       of his arrow (their off marker) was removed and redrawn ~10 times in 1.1 s — keyed on her
 *       marker's spot, every move remounted it and restarted its fade. Her marker glides; so does
 *       its ghost: one key while it moves, a new fade only when it comes back from nowhere.
 *  p2 — REQ-852 AMENDMENT: End's question, out of a right-docked peek at 1024×768, was first
 *       painted at the peek's left (x 567–1238, "Sí" off-screen) and GLIDED to its placed box
 *       over ~250 ms. The asking placement that moves the dock paints at its box (no glide).
 *  p1 — REQ-648 AMENDMENT REVISION: "Catching up…" is for a switch to a tab the stage already
 *       followed; a brand-new tab's first load says "Loading their next page…" (REQ-648) — as does
 *       the link's brief connecting state while that page is awaited.
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

/** Maria (onboarded) on `path` in her own window; Alex on the stage, the demo live */
async function setUp(
  // deno-lint-ignore no-explicit-any
  page: any,
  http: StoryTools["http"],
  baseUrl: string,
  path: string,
  lang: "en" | "es",
  viewport: { width: number; height: number },
  waitFold = true,
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
  await page.locator("[data-cy='demo-status']").filter({
    hasText: /^\s*(Live|En vivo)\s*$/,
  }).waitFor({ timeout: 25_000 });
  await tab.locator("[data-cy='demo-pill']").waitFor({ timeout: 20_000 });
  if (waitFold) {
    await tab.locator("[data-cy='demo-pill'][data-tucked]").waitFor({
      timeout: 30_000,
    });
  }
  await tab.waitForTimeout(500);
  return { userCtx, tab, userCookie: user.cookie };
}

const ghostState = () => {
  const g = document.querySelector<HTMLElement>("[data-cy='demo-pointer-ghost']");
  const m = g?.querySelector<HTMLElement>("[data-cy='demo-pointer-ghost-off-mark']");
  const r = g?.getBoundingClientRect();
  return {
    ghost: !!g,
    off: g?.hasAttribute("data-off") ?? false,
    at: r ? [Math.round(r.left), Math.round(r.top)] : null,
    markOpacity: m ? Number(getComputedStyle(m).opacity) : null,
    offBadge: !!document.querySelector("[data-cy='demo-pointer-off']"),
  };
};

Deno.test("REQ-877 AMENDMENT (demo-loop run 19, m2): the presenter's mouse moves beside the frame — the stage's ghost of their off marker stays drawn and moves with it, never removed and redrawn", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx } = await setUp(page, http, baseUrl, "/settings", "es", {
      width: 1280,
      height: 800,
    }, false);
    try {
      const frame = await page.locator("[data-cy='demo-frame']").boundingBox();
      if (!frame) throw new Error("no frame on the stage");
      // in the frame, then 40 px left of it; a 1.5 s rest draws the off ghost
      await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2, { steps: 4 });
      await page.waitForTimeout(600);
      const x = frame.x - 40;
      let y = frame.y + 200;
      await page.mouse.move(x, y, { steps: 6 });
      await page.waitForTimeout(1_500);
      const rested = await page.evaluate(ghostState);
      expect(rested.ghost && rested.off, `the off ghost is drawn after the rest (${JSON.stringify(rested)})`);
      // then down 15 px every ~60 ms, 15 times, still beside the frame; sampled every ~16 ms
      const samples: ({ at: number } & ReturnType<typeof ghostState>)[] = [];
      const t0 = Date.now();
      let moving = true;
      const sampler = (async () => {
        while (moving) {
          samples.push({ at: Date.now() - t0, ...(await page.evaluate(ghostState)) });
          await page.waitForTimeout(8);
        }
      })();
      for (let i = 0; i < 15; i++) {
        y += 15;
        await page.mouse.move(x, y);
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(200);
      moving = false;
      await sampler;
      await page.screenshot({ path: `${folder}/ghost-beside-frame.png` });
      await Deno.writeTextFile(`${folder}/ghost-samples.json`, JSON.stringify({ frame, rested, samples }, null, 1));
      const absent = samples.filter((s) => !s.ghost);
      const faint = samples.filter((s) => s.ghost && s.markOpacity !== null && s.markOpacity < 0.1);
      const spots = new Set(samples.filter((s) => s.at).map((s) => JSON.stringify(s.at))).size;
      expect(
        absent.length === 0,
        `m2: the ghost is never removed while he moves beside the frame (${absent.length} of ${samples.length} samples without it: ${JSON.stringify(absent.slice(0, 4).map((s) => s.at))})`,
      );
      expect(
        faint.length === 0,
        `m2: its marker never restarts its fade from nothing (${faint.length} of ${samples.length} samples under 0.1 opacity)`,
      );
      expect(spots > 1, `the ghost moved with the marker (${spots} spots seen)`);
    } finally {
      await userCtx.close();
    }
  }));

const pillRect = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  const r = pill?.getBoundingClientRect();
  const yes = document.querySelector<HTMLElement>("[data-cy='demo-end-confirm']")?.getBoundingClientRect();
  return {
    box: r ? [r.left, r.top, r.width, r.height].map(Math.round) : null,
    yes: yes ? [yes.left, yes.right].map(Math.round) : null,
    asking: !!document.querySelector("[data-cy='demo-end-ask']"),
    w: globalThis.innerWidth,
  };
};

Deno.test("REQ-852 AMENDMENT (demo-loop run 19, p2): 1024×768, the right-docked tab — End asks out of the peek: every frame of the question is inside the window, 'Yes' included (no glide in from the peek's spot)", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx, tab } = await setUp(page, http, baseUrl, "/dashboard", "en", {
      width: 1024,
      height: 768,
    });
    try {
      const tb = (await tab.evaluate(pillRect)).box!;
      const c: [number, number] = [tb[0] + tb[2] / 2, tb[1] + tb[3] / 2];
      await tab.mouse.move(c[0], c[1] + 120);
      await tab.mouse.move(c[0], c[1], { steps: 5 });
      await tab.waitForTimeout(700);
      const end = await tab.locator("[data-cy='demo-end']").boundingBox();
      if (!end) throw new Error("no End on the peek");
      await tab.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 5 });
      await tab.waitForTimeout(1_200); // a deliberate End (REQ-890 A6 REVISION 2)
      const seen: ({ at: number } & ReturnType<typeof pillRect>)[] = [];
      const t0 = Date.now();
      const run = (async () => {
        while (Date.now() - t0 < 600) {
          seen.push({ at: Date.now() - t0, ...(await tab.evaluate(pillRect)) });
          await tab.waitForTimeout(6);
        }
      })();
      await tab.mouse.down();
      await tab.mouse.up();
      await run;
      await tab.screenshot({ path: `${folder}/question-1024.png` });
      await Deno.writeTextFile(`${folder}/question-frames.json`, JSON.stringify({ tb, end, seen }, null, 1));
      const asking = seen.filter((s) => s.asking && s.box);
      expect(asking.length >= 10, `the question was sampled (${asking.length} of ${seen.length})`);
      const out = asking.filter((s) => s.box![0] + s.box![2] > s.w + 1 || s.box![0] < -1 || (s.yes && s.yes[1] > s.w + 1));
      expect(
        out.length === 0,
        `p2: every frame of the question is inside the window: ${JSON.stringify(out.slice(0, 5).map((s) => [s.at, s.box, s.yes]))}`,
      );
      const last = asking[asking.length - 1];
      const moved = asking.filter((s) => Math.abs(s.box![0] - last.box![0]) > 4);
      expect(
        moved.length === 0,
        `p2: the question is painted at its box from its first frame (no glide): ${JSON.stringify(moved.slice(0, 5).map((s) => [s.at, s.box]))}`,
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-648 AMENDMENT REVISION (demo-loop run 19, p1): the customer opens a NEW tab during the demo — the stage says 'Loading their next page…' for it, never 'Catching up…' nor 'Connecting…'; back to the first tab (already followed) it says 'Catching up…'", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx, tab } = await setUp(page, http, baseUrl, "/dashboard", "en", {
      width: 1280,
      height: 800,
    }, false);
    try {
      const STATUS = "[data-cy='demo-status']";
      const sample = async (ms: number) => {
        const out: { at: number; status: string; path: string }[] = [];
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const s = await page.evaluate((sel: string) => ({
            status: (document.querySelector<HTMLElement>(sel)?.innerText ?? "").trim(),
            path: document.querySelector("[data-cy='demo-frame']")?.getAttribute("data-path") ?? "",
          }), STATUS).catch(() => null);
          if (s) out.push({ at: Date.now() - t0, ...s });
          await page.waitForTimeout(25);
        }
        return out;
      };
      // a brand-new tab of hers: its first page load
      const run1 = sample(6_000);
      const tab2 = await userCtx.newPage();
      await tab2.goto(`${baseUrl}/customers?lang=en`);
      await tab2.bringToFront();
      const s1 = await run1;
      await page.waitForTimeout(500);
      // back to the first tab: a switch to a tab the stage followed before
      const run2 = sample(4_000);
      await tab.bringToFront();
      await tab.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      // his pointer moves on her page but clicks nothing: a click at (300, 300) lands on the
      // sidebar's Assistant link — a same-tab navigation, whose word IS "Loading their next page…"
      await tab.mouse.move(300, 300);
      await tab.mouse.move(640, 400);
      const s2 = await run2;
      await Deno.writeTextFile(`${folder}/status-samples.json`, JSON.stringify({ newTab: s1, back: s2 }, null, 1));
      const words = (xs: typeof s1) => [...new Set(xs.map((s) => s.status))];
      const newTabWords = words(s1);
      expect(
        s1.some((s) => s.path.startsWith("/customers")),
        `the stage reached the new tab (${JSON.stringify(newTabWords)})`,
      );
      expect(
        !s1.some((s) => /Catching up|Poniéndose/.test(s.status)),
        `p1: a new tab's first load never says Catching up… (${JSON.stringify(newTabWords)})`,
      );
      expect(
        !s1.some((s) => /^(Connecting|Conectando)/.test(s.status)),
        `p1: nor Connecting… while her page is still on show (${JSON.stringify(newTabWords)})`,
      );
      // the switch back: Catching up… or straight to Live (a snapshot can be in within a sample)
      expect(
        s2.some((s) => s.path.startsWith("/dashboard")),
        `the stage went back to the first tab (${JSON.stringify(words(s2))})`,
      );
      expect(
        !s2.some((s) => /Loading their next page/.test(s.status)),
        `REQ-648 AMENDMENT: a tab followed before never says Loading their next page… (${JSON.stringify(words(s2))})`,
      );
    } finally {
      await userCtx.close();
    }
  }));
