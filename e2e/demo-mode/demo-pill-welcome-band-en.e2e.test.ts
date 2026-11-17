/**
 * REQ-866 AMENDMENT 2 (demo-loop run 12, m1; by hand) — the ENGLISH /welcome step 2 at 390×844
 * has a language-hint row the Spanish one does not, and its 43 px compact pill fit no half-step
 * row (REQ-866 AMENDMENT): the join grace's whole pill sat on the hint "At least one language
 * stays on…" for the whole grace, while the 53 px band between Continue (600) and "Skip setup for
 * now" (653) was clear. The pill now reads the page's own clear bands (`pillBands`) when no row
 * is clear — that band is the card's painted foot, the least of the page (no text, no control):
 * it takes that band, and the hint is never covered.
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
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
}

/** the pill's box, whether it is folded, its words, and what of the page is under it */
const sample = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  if (!pill) return null;
  const r = pill.getBoundingClientRect();
  const under = new Set<string>();
  for (let x = r.left + 4; x < r.right; x += 24) {
    for (let y = r.top + 4; y < r.bottom; y += 12) {
      const e = document.elementsFromPoint(x, y).find((n) =>
        !pill.contains(n) && !n.closest("[data-demo-overlay]")
      );
      if (e) under.add(`${e.localName}.${e.classList[0] ?? ""}`);
    }
  }
  return {
    box: [r.left, r.top, r.width, r.height].map(Math.round),
    tucked: pill.hasAttribute("data-tucked"),
    text: (pill.textContent ?? "").trim().slice(0, 60),
    under: [...under],
  };
};

Deno.test("REQ-866 AMENDMENT 2 (demo-loop run 12, m1): the ENGLISH customer on /welcome step 2 at 390×844 — the join grace's whole pill takes the clear band between Continue and 'Skip setup for now', never the language hint", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Maria Lopez" }),
    })).body?.cancel();
    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      body: JSON.stringify({ language: "en", name: "Alex" }),
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
    const userCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await tab.goto(`${baseUrl}/welcome?lang=en`);
      await tab.locator("h1.welcome__question").waitFor({ timeout: 15_000 });
      expect(
        /business called/.test(
          await tab.locator("h1.welcome__question").innerText(),
        ),
        "the English step 2",
      );
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto(`${baseUrl}/admin?lang=en`);
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      // the join grace: the whole pill from the demo's arrival for a few seconds
      const samples:
        (NonNullable<ReturnType<typeof sample>> & { at: number })[] = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 4_000) {
        const s = await tab.evaluate(sample);
        if (s) samples.push({ ...s, at: Date.now() - t0 });
        await tab.waitForTimeout(150);
      }
      await tab.screenshot({ path: `${folder}/welcome-en-pill-390.png` });
      // settled: the pill glides to its spot (REQ-379); what it sits on is judged from 1.5 s on
      const open = samples.filter((s) => !s.tucked && s.at >= 1_500);
      expect(
        open.length >= 5,
        `the whole pill is out through the join grace (${
          JSON.stringify(samples.slice(0, 6))
        })`,
      );
      expect(
        open.some((s) => /guiding/.test(s.text)),
        `it says "Alex is guiding you" (${
          JSON.stringify(open.map((s) => s.text))
        })`,
      );
      const onText = open.filter((s) =>
        s.under.some((u) =>
          /welcome__question|welcome__why|welcome__hint|welcome__send-in|welcome__step|welcome__escape|welcome__btn/
            .test(u)
        )
      );
      expect(
        onText.length === 0,
        `m1: never over the question, its hint or the language hint — ${
          JSON.stringify(onText.slice(0, 3))
        } (all: ${
          JSON.stringify(
            samples.map((s) => [s.at, s.box[1], s.tucked ? "t" : "o"]),
          )
        })`,
      );
      // in the band between Continue and "Skip setup for now"
      const bands = await tab.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const cont = btns.find((b) => /^Continue$/.test((b.textContent ?? "").trim()));
        const skip = btns.find((b) => /Skip setup for now/.test(b.textContent ?? ""));
        return {
          contBottom: cont ? cont.getBoundingClientRect().bottom : null,
          skipTop: skip ? skip.getBoundingClientRect().top : null,
        };
      });
      const last = open[open.length - 1];
      expect(
        bands.contBottom !== null && bands.skipTop !== null &&
          last.box[1] >= bands.contBottom - 1 &&
          last.box[1] + last.box[3] <= bands.skipTop + 1,
        `the pill sits in the Continue/Skip band (${
          JSON.stringify({ last, bands })
        })`,
      );
    } finally {
      await userCtx.close();
    }
  }));

/** the pill's box, its words, whether it is the restart line, and what is under it (with words) */
const sampleMore = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  if (!pill) return null;
  const r = pill.getBoundingClientRect();
  const under = new Set<string>();
  for (let x = r.left + 4; x < r.right; x += 24) {
    for (let y = r.top + 4; y < r.bottom; y += 12) {
      const e = document.elementsFromPoint(x, y).find((n) =>
        !pill.contains(n) && !n.closest("[data-demo-overlay]")
      );
      if (e) under.add(`${e.localName}.${e.classList[0] ?? ""}`);
    }
  }
  return {
    box: [r.left, r.top, r.width, r.height].map(Math.round),
    tucked: pill.hasAttribute("data-tucked"),
    restarted: pill.hasAttribute("data-restarted"),
    tf: getComputedStyle(pill).transform,
    text: (pill.textContent ?? "").trim().slice(0, 60),
    under: [...under],
  };
};
type More = NonNullable<ReturnType<typeof sampleMore>> & { at: number };
const ON_PAGE =
  /^(button|a|input|select|textarea)\.|welcome__question|welcome__why|welcome__hint|welcome__send-in|welcome__step|welcome__escape|welcome__btn|welcome__lang/;

// deno-lint-ignore no-explicit-any
async function welcomeDemo(page: any, http: StoryTools["http"], baseUrl: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: "en", name: "Maria Lopez" }),
  })).body?.cancel();
  const admin = await verify(http, adminPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: "en", name: "Alex" }),
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
  await tab.goto(`${baseUrl}/welcome?lang=en`);
  await tab.locator("h1.welcome__question").waitFor({ timeout: 15_000 });
  await useCookie(page.context(), baseUrl, admin.cookie);
  const open = async () => {
    await page.goto(`${baseUrl}/admin?lang=en`);
    await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
    await page.locator("[data-cy='adm-search']").click();
    await page.locator("[data-cy='adm-demo']").first().waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='adm-demo']").first().click();
  };
  /** samples every `every` ms for `ms`, from now — `open` runs meanwhile */
  const watch = async (ms: number, every: number, meanwhile: () => Promise<void>) => {
    const out: More[] = [];
    const t0 = Date.now();
    const run = (async () => {
      while (Date.now() - t0 < ms) {
        const x = await tab.evaluate(sampleMore).catch(() => null);
        if (x) out.push({ ...x, at: Date.now() - t0 });
        await tab.waitForTimeout(every);
      }
    })();
    await meanwhile();
    await run;
    return out;
  };
  return { userCtx, tab, open, watch };
}

Deno.test("REQ-820 AMENDMENT (demo-loop run 13, p1): the join's whole pill on EN /welcome step 2 at 390×844 appears IN its band — it never glides there from the folded tab's spot across the language buttons, the question, an input and Back", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const w = await welcomeDemo(page, http, baseUrl);
    try {
      const samples = await w.watch(4_000, 40, w.open);
      await w.tab.screenshot({ path: `${folder}/welcome-en-join-390.png` });
      const open = samples.filter((s) => !s.tucked);
      expect(open.length >= 10, `the whole pill is sampled (${JSON.stringify(samples.slice(0, 5))})`);
      const last = open[open.length - 1];
      const away = open.filter((s) => Math.abs(s.box[1] - last.box[1]) > 4);
      expect(
        away.length === 0,
        `p1: every whole-pill sample is at its settled spot (top ${last.box[1]}) — no glide: ${
          JSON.stringify(away.slice(0, 6).map((s) => [s.at, s.box, s.tf.slice(0, 32)]))
        }`,
      );
      const onPage = open.filter((s) => s.under.some((u) => ON_PAGE.test(u)));
      expect(
        onPage.length === 0,
        `p1: never over a control or the page's words, from the first frame: ${
          JSON.stringify(onPage.slice(0, 4).map((s) => [s.at, s.box, s.under]))
        }`,
      );
    } finally {
      await w.userCtx.close();
    }
  }));

Deno.test("REQ-298 AMENDMENT (demo-loop run 13, p2): the restart's pill on EN /welcome step 2 at 390×844 is one row ('Alex · new demo'), so it fits a clear band — never 54 px tall over 'Step 2 of 10'", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const w = await welcomeDemo(page, http, baseUrl);
    try {
      await w.open();
      await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
      await w.tab.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
      await w.tab.waitForTimeout(6_000);
      // End from the stage; then Demo again on /admin
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      await w.tab.locator("[data-cy='demo-pill']").waitFor({ state: "hidden", timeout: 15_000 });
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
      const samples = await w.watch(8_000, 150, w.open);
      await w.tab.screenshot({ path: `${folder}/welcome-en-restart-390.png` });
      const restarted = samples.filter((s) => s.restarted && !s.tucked);
      expect(
        restarted.length >= 5,
        `the restart line is up for a while (${JSON.stringify(samples.slice(0, 6).map((s) => [s.at, s.restarted, s.text]))})`,
      );
      expect(
        restarted.every((s) => /new demo/.test(s.text)),
        `p2: the compact line says 'new demo' (${JSON.stringify(restarted.map((s) => s.text).slice(0, 3))})`,
      );
      const tall = restarted.filter((s) => s.box[3] > 48);
      expect(
        tall.length === 0,
        `p2: the restart pill is one row (≤ 48 px) — ${JSON.stringify(tall.slice(0, 3).map((s) => [s.at, s.box]))}`,
      );
      const settled = restarted.filter((s) => s.at >= 1_500);
      const onPage = settled.filter((s) => s.under.some((u) => ON_PAGE.test(u)));
      expect(
        onPage.length === 0,
        `p2: never over the step count, the question, its hint or a button — ${
          JSON.stringify(onPage.slice(0, 4).map((s) => [s.at, s.box, s.under]))
        }`,
      );
    } finally {
      await w.userCtx.close();
    }
  }));
