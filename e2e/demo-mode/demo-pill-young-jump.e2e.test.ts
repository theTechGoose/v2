/**
 * REQ-820 AMENDMENT 3 + REQ-833 AMENDMENT (demo-loop run 15, m1 + p1; by hand) — the customer's
 * pill at 390 px on the Spanish /welcome.
 *  m1 — her FIRST join: 5 of 5 testers saw the whole pill painted at its home (over the form's
 *       footer) and gliding 156–186 px up to its band over ~260 ms. A young pill — its first
 *       placement, and every one within PILL_YOUNG_MS of its coming out whole — jumps to where it
 *       is placed: every visible whole-pill frame is at the settled spot.
 *  p1 — the RESTART: "Alex · nueva demo" sat on the controls' row and wrapped to two lines (54 px)
 *       beside the wide "Conectando…", then one (43 px) at "Conectado" — an 11 px jump plus an
 *       8 px re-place. The line on the controls' row is cut, never wrapped: one height, one spot,
 *       for as long as the line is up.
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

/** Maria (ES, not onboarded) on /welcome at 390×844; Alex on /admin with her row found */
// deno-lint-ignore no-explicit-any
async function setUp(page: any, http: StoryTools["http"], baseUrl: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: "es", name: "Maria Lopez" }),
  })).body?.cancel();
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
  if (boot.status !== 200) throw new Error(`bootstrap: ${boot.status}`);
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser behind the story page");
  const userCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const tab = await userCtx.newPage();
  await useCookie(userCtx, baseUrl, user.cookie);
  await tab.goto(`${baseUrl}/welcome?lang=es`);
  await useCookie(page.context(), baseUrl, admin.cookie);
  await page.goto(`${baseUrl}/admin?lang=es`);
  await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
  await page.locator("[data-cy='adm-search']").click();
  await page.locator("[data-cy='adm-demo']").first().waitFor({
    timeout: 15_000,
  });
  const pressDemo = async () => {
    await page.locator("[data-cy='adm-demo']").first().click();
    await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
    await tab.locator("[data-cy='demo-pill']").waitFor({ timeout: 20_000 });
  };
  return { userCtx, tab, pressDemo };
}

const samplePill = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  if (!pill) return null;
  const r = pill.getBoundingClientRect();
  const cs = getComputedStyle(pill);
  return {
    box: [r.left, r.top, r.width, r.height].map(Math.round),
    tucked: pill.hasAttribute("data-tucked"),
    hidden: cs.visibility === "hidden" || cs.opacity === "0",
    tf: cs.transform,
    text: (pill.innerText ?? "").replace(/\s+/g, " ").slice(0, 80),
  };
};
type Sample = NonNullable<ReturnType<typeof samplePill>> & { at: number };

// deno-lint-ignore no-explicit-any
async function sampleFor(tab: any, ms: number, every = 20): Promise<Sample[]> {
  const out: Sample[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const x = await tab.evaluate(samplePill).catch(() => null);
    if (x) out.push({ ...x, at: Date.now() - t0 });
    await tab.waitForTimeout(every);
  }
  return out;
}

Deno.test("REQ-820 AMENDMENT 3 (demo-loop run 15, m1): her first join at 390×844 on the Spanish /welcome — every visible whole-pill frame is at the pill's settled spot: it never shows at its home and glides up the form", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx, tab, pressDemo } = await setUp(page, http, baseUrl);
    try {
      await tab.waitForTimeout(1_000);
      const run = sampleFor(tab, 5_000);
      await pressDemo();
      const samples = await run;
      await tab.screenshot({ path: `${folder}/first-join-390.png` });
      await Deno.writeTextFile(`${folder}/first-join-samples.json`, JSON.stringify(samples));
      const whole = samples.filter((s) => !s.tucked && !s.hidden);
      expect(whole.length >= 10, `the whole pill was sampled (${samples.length} samples)`);
      const last = whole[whole.length - 1];
      const away = whole.filter((s) => Math.abs(s.box[1] - last.box[1]) > 4);
      expect(
        away.length === 0,
        `m1: every whole frame is at its spot ${JSON.stringify(last.box)} — no glide from its home: ${
          JSON.stringify(away.slice(0, 6).map((s) => [s.at, s.box, s.tf.slice(0, 36)]))
        }`,
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-833 AMENDMENT (demo-loop run 15, p1): the restart at 390×844 — 'Alex · nueva demo' on the controls' row keeps ONE height and one spot while 'Conectando…' turns into 'Conectado' (it was 54 px wrapped, then 43 px: a 19 px settle in two jumps)", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx, tab, pressDemo } = await setUp(page, http, baseUrl);
    try {
      await pressDemo();
      await tab.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Conectado\s*$/,
      }).waitFor({ timeout: 20_000 });
      // Alex ends it from the stage; the next Demo is a restart (REQ-298)
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      await tab.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      const run = sampleFor(tab, 5_000);
      await page.locator("[data-cy='adm-demo']").first().click();
      const samples = await run;
      await tab.screenshot({ path: `${folder}/restart-390.png` });
      await Deno.writeTextFile(`${folder}/restart-samples.json`, JSON.stringify(samples));
      const said = samples.filter((s) =>
        !s.tucked && !s.hidden && /nueva demo/.test(s.text)
      );
      expect(said.length >= 10, `the restart line was sampled (${samples.length} samples)`);
      const connected = said.filter((s) => /Conectado\b/.test(s.text));
      expect(connected.length > 0, "the status turned Conectado while the line was up");
      const heights = [...new Set(said.map((s) => s.box[3]))];
      expect(
        heights.length === 1,
        `p1: one height while the line is up (saw ${heights.join(", ")}): ${
          JSON.stringify(said.filter((s, i) => i === 0 || s.box[3] !== said[i - 1].box[3]).map((s) => [s.at, s.box, s.text.slice(0, 40)]))
        }`,
      );
      expect(
        heights[0] <= 46,
        `the line shares the controls' row (${heights[0]} px, one row)`,
      );
      const tops = [...new Set(said.map((s) => s.box[1]))];
      expect(
        Math.max(...tops) - Math.min(...tops) <= 1,
        `one spot while the line is up (tops ${tops.join(", ")})`,
      );
    } finally {
      await userCtx.close();
    }
  }));
