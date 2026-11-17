/**
 * REQ-820 AMENDMENT (demo-loop run 13, p4; by hand) — the folded tab carried to the next page
 * (REQ-830) became the whole pill AT the tab's spot and glided from there: from a right-edge tab
 * on /dashboard the whole pill stood at x 306 on a 390 px screen for ~700 ms ("Terminar demo"
 * off-screen) on /worker's load; from a left-edge tab it glided 440 px down to its home. The
 * placement that turns the tab into the whole pill now jumps to its box (REQ-820's rule, which
 * covered the peek alone): every whole-pill sample of the load is inside the window, at its spot.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
let LANG = "en";
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
// deno-lint-ignore no-explicit-any
async function useCookie(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: LANG, domain, path: "/" },
  ]));
}


// deno-lint-ignore no-explicit-any
async function demoOn(page: any, http: StoryTools["http"], baseUrl: string, path: string, lang: "en" | "es", onboarded: boolean) {
  await page.setViewportSize({ width: 1280, height: 800 });
  LANG = lang;
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: lang, name: "Maria Lopez" }),
  })).body?.cancel();
  if (onboarded) {
    await answerQuestions(http, user.auth, { name: "Maria Lopez", businessName: "Lopez Roofing" });
  }
  const admin = await verify(http, adminPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: lang, name: "Alex" }),
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
  const userCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const tab = await userCtx.newPage();
  await useCookie(userCtx, baseUrl, user.cookie);
  await tab.goto(`${baseUrl}${path}?lang=${lang}`);
  await useCookie(page.context(), baseUrl, admin.cookie);
  await page.goto(`${baseUrl}/admin?lang=${lang}`);
  await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
  await page.locator("[data-cy='adm-search']").click();
  await page.locator("[data-cy='adm-demo']").first().waitFor({ timeout: 15_000 });
  await page.locator("[data-cy='adm-demo']").first().click();
  await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
  await tab.locator("[data-cy='demo-pill']").waitFor({ timeout: 20_000 });
  return { userCtx, tab };
}

const samplePill = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  if (!pill) return null;
  const r = pill.getBoundingClientRect();
  return {
    box: [r.left, r.top, r.width, r.height].map(Math.round),
    tucked: pill.hasAttribute("data-tucked"),
    tf: getComputedStyle(pill).transform,
  };
};

Deno.test("REQ-820 AMENDMENT (demo-loop run 13, p4): the folded tab on /dashboard at 390×844 (ES), then a full load of /worker — every whole-pill frame of the load is inside the 390 px window and at its settled spot, never half off the right edge or gliding in from the tab", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx, tab } = await demoOn(page, http, baseUrl, "/dashboard", "es", true);
    try {
      await tab.locator("[data-cy='demo-pill'][data-tucked]").waitFor({ timeout: 30_000 });
      const from = await tab.evaluate(samplePill);
      const samples: (NonNullable<ReturnType<typeof samplePill>> & { at: number })[] = [];
      const t0 = Date.now();
      const run = (async () => {
        while (Date.now() - t0 < 4_000) {
          const x = await tab.evaluate(samplePill).catch(() => null);
          if (x) samples.push({ ...x, at: Date.now() - t0 });
          await tab.waitForTimeout(25);
        }
      })();
      await tab.goto(`${baseUrl}/worker?lang=es`).catch(() => {});
      await run;
      await tab.screenshot({ path: `${folder}/worker-load-390.png` });
      const whole = samples.filter((s) => !s.tucked);
      expect(
        whole.length >= 3,
        `the carried pill shows whole on the new page (from ${JSON.stringify(from)}; ${
          JSON.stringify(samples.slice(0, 5))
        })`,
      );
      const off = whole.filter((s) => s.box[0] < 0 || s.box[0] + s.box[2] > 390);
      expect(
        off.length === 0,
        `p4: never past the window's edge (tab was at ${JSON.stringify(from?.box)}): ${
          JSON.stringify(off.slice(0, 4).map((s) => [s.at, s.box]))
        }`,
      );
      const last = whole[whole.length - 1];
      const away = whole.filter((s) =>
        Math.abs(s.box[1] - last.box[1]) > 4 || Math.abs(s.box[0] - last.box[0]) > 4
      );
      expect(
        away.length === 0,
        `p4: every whole-pill frame is at its settled spot (${JSON.stringify(last.box)}) — no glide from the tab: ${
          JSON.stringify(away.slice(0, 6).map((s) => [s.at, s.box, s.tf.slice(0, 32)]))
        }`,
      );
    } finally {
      await userCtx.close();
    }
  }));
