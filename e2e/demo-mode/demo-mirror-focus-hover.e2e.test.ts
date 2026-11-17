/**
 * REQ-824 (demo-loop cycle dm1, m2) — the customer's hover and focus, shown on the stage.
 *
 * Demo 2: "focused: green border on the customer, unfocused pink fill on the stage"; the chip and
 * the calendar day under her mouse lit up only on her screen; the top search's native × showed only
 * on hers. The stage's frame is inert, untabbable and takes no pointer (REQ-293), so nothing in it
 * is ever focused or hovered; now the recorder marks what the customer's browser says matches, and
 * the stage reads the marks in the customer's own rules (and in its own sheet of the UA's rules).
 *
 * 1. The real recorder and replayer in Chromium, the app's own `assistant-page.css`: the customer on
 *    one page, the stage's inert MIRROR_SRCDOC frame on another at the customer's size (the frames
 *    cross on a BroadcastChannel). Idle, focused and blurred, the stage's composer computes the
 *    customer's border and background; the hovered `.dur__chip` the same border; a search box with
 *    "Tom" typed shows its × on both sides (the same ink); a keyboard-focused button the same focus
 *    ring, a mouse-focused one none.
 * 2. A real demo: the customer clicks into the /assistant composer and the stage frame's composer
 *    computes the customer's focused border and background within 1.5 s.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const ROOT = new URL("../../", import.meta.url);

/** the customer's recorder and the stage's replayer, bundled for the browser as `window.__mm` */
async function mirrorBundle(): Promise<string> {
  const dir = await Deno.makeTempDir();
  const entry = `${dir}/entry.ts`;
  const lib = (p: string) =>
    JSON.stringify(new URL(`front-end/lib/demo-mode/${p}`, ROOT).href);
  await Deno.writeTextFile(
    entry,
    `import * as rec from ${lib("mirror-record.ts")};\n` +
      `import * as rep from ${lib("mirror-replay.ts")};\n` +
      `(globalThis as unknown as { __mm: unknown }).__mm = { rec, rep };\n`,
  );
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--quiet", "--platform", "browser", "--no-check", entry],
    cwd: new URL(".", ROOT).pathname,
    stdout: "piped",
    stderr: "piped",
  }).output();
  await Deno.remove(dir, { recursive: true });
  if (!out.success) {
    throw new Error(`deno bundle: ${new TextDecoder().decode(out.stderr)}`);
  }
  return new TextDecoder().decode(out.stdout);
}

type Page = StoryTools["page"];

/** polls `fn` every 50 ms for `ms`: the first answer `ok` takes, or the last one */
async function until<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  ms: number,
): Promise<T> {
  const t0 = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 50));
    v = await fn();
  }
  return v;
}

/** the computed `props` of the first `sel` in the page (null: no such element) */
const lookIn = (page: Page, sel: string, props: string[]) =>
  page.evaluate(
    `(() => { const e = document.querySelector(${
      JSON.stringify(sel)
    }); if (!e) return null; const cs = getComputedStyle(e); return ${
      JSON.stringify(props)
    }.map((p) => cs.getPropertyValue(p)).join(" | "); })()`,
  ) as Promise<string | null>;

/** the same, in the stage page's mirror frame (`frame`: its selector) */
const lookInFrame = (page: Page, frame: string, sel: string, props: string[]) =>
  page.evaluate(
    `(() => { const f = document.querySelector(${
      JSON.stringify(frame)
    }); const d = f && f.contentDocument; const e = d && d.querySelector(${
      JSON.stringify(sel)
    }); if (!e) return null; const cs = d.defaultView.getComputedStyle(e); return ${
      JSON.stringify(props)
    }.map((p) => cs.getPropertyValue(p)).join(" | "); })()`,
  ) as Promise<string | null>;

const COMPOSER = [
  "border-top-color",
  "border-left-color",
  "background-color",
];
const CHIP = ["border-top-color", "background-color", "color"];
const RING = [
  "outline-style",
  "outline-width",
  "outline-color",
  "outline-offset",
];

/** pixels of a screenshot, counted in `page` (where it is decoded): "dark" ones in its right `w`
 *  px (a search box's ×), or "ring" ones — the blue of Chromium's focus ring — anywhere */
async function ink(
  page: Page,
  png: Uint8Array,
  kind: "dark" | "ring",
  w = 30,
): Promise<number> {
  let bin = "";
  for (const b of png) bin += String.fromCharCode(b);
  return await page.evaluate(
    async ([b64, kind, w]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext("2d")!;
      x.drawImage(img, 0, 0);
      const from = kind === "dark" ? Math.max(0, img.width - w) : 0;
      const d = x.getImageData(from, 0, img.width - from, img.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        if (kind === "dark" ? r + g + b < 450 : b > 150 && r < 90 && g < 150) {
          n++;
        }
      }
      return n;
    },
    [btoa(bin), kind, w] as const,
  );
}
const inkRight = (page: Page, png: Uint8Array) => ink(page, png, "dark");

const VIEW = { width: 760, height: 560 };
const STAGE = "#stage";

Deno.test("REQ-824 (cycle dm1, m2): the real recorder and replayer with the app's own assistant-page.css — the stage's composer computes the customer's border and background idle, focused and blurred; the hovered chip, the search box's × and a keyboard focus ring are the same on both sides", (t) =>
  story(t, async ({ page, expect, baseUrl, folder }) => {
    const js = await mirrorBundle();
    await page.setViewportSize(VIEW);
    const stagePage = await page.context().newPage();
    try {
      await stagePage.setViewportSize(VIEW);
      // the stage: a page of the app's origin holding only the mirror frame, at the customer's
      // size, inert and untabbable, taking no pointer (REQ-293: as DemoStage's)
      await stagePage.goto(`${baseUrl}/clients.css`);
      await stagePage.addScriptTag({ content: js });
      await stagePage.evaluate(async ([w, h]) => {
        document.head.innerHTML = "";
        document.body.innerHTML =
          `<iframe id="stage" sandbox="allow-same-origin" inert tabindex="-1" aria-hidden="true" ` +
          `style="position:fixed;left:0;top:0;width:${w}px;height:${h}px;border:0;pointer-events:none;background:#fff"></iframe>`;
        // deno-lint-ignore no-explicit-any
        const mm = (globalThis as any).__mm;
        const f = document.getElementById("stage") as HTMLIFrameElement;
        const loaded = new Promise((r) => f.addEventListener("load", r));
        f.srcdoc = mm.rep.MIRROR_SRCDOC;
        await loaded;
        const replay = mm.rep.createReplayer(f.contentDocument!);
        new BroadcastChannel("req-824").onmessage = (e) =>
          replay.apply(JSON.parse(e.data));
      }, [VIEW.width, VIEW.height] as const);

      // the customer: the composer, a duration chip, the top search with "Tom" typed, two buttons
      await page.goto(`${baseUrl}/clients.css`);
      await page.addScriptTag({ content: js });
      await page.evaluate(async () => {
        document.head.innerHTML =
          `<link rel="stylesheet" href="/assistant-page.css">`;
        // her page is styled before anything is read from it
        const link = document.head.querySelector("link")!;
        await new Promise((r) => {
          link.addEventListener("load", r);
          link.addEventListener("error", r);
        });
        document.body.innerHTML = `<div style="width:520px;padding:16px">` +
          `<div class="topbar__search" style="max-width:300px">` +
          `<input type="search" id="search" value="Tom" style="caret-color:transparent"></div>` +
          `<div class="composer" style="margin-top:16px"><div class="composer__inner">` +
          `<textarea class="composer__input" rows="2" placeholder="Type a job"></textarea></div></div>` +
          `<div class="dur" style="margin-top:16px">` +
          `<button type="button" class="dur__chip" id="chip">2–3 days</button></div>` +
          `<p style="margin-top:16px"><button type="button" id="before">Before</button> ` +
          `<button type="button" id="plain">Plain</button></p></div>`;
        // deno-lint-ignore no-explicit-any
        const mm = (globalThis as any).__mm;
        const ch = new BroadcastChannel("req-824");
        mm.rec.createRecorder(document, {
          emit: (fr: unknown) => ch.postMessage(JSON.stringify(fr)),
        }).snapshot();
      });
      await page.mouse.move(VIEW.width - 5, VIEW.height - 5);

      const customer = (sel: string, props: string[]) =>
        lookIn(page, sel, props);
      const stage = (sel: string, props: string[]) =>
        lookInFrame(stagePage, STAGE, sel, props);
      /** the stage's look of `sel` once it is the customer's (within `ms`), and the customer's */
      const same = async (sel: string, props: string[], ms: number) => {
        const want = await customer(sel, props);
        const got = await until(() => stage(sel, props), (v) => v === want, ms);
        return { want, got };
      };

      // 0. idle: the stage is styled by the app's sheet and computes what the customer does
      const idle = await customer(".composer__inner", COMPOSER);
      expect(
        idle !== null && !idle.endsWith("rgba(0, 0, 0, 0)"),
        `the customer's composer is styled by assistant-page.css (${idle})`,
      );
      const idle0 = await same(".composer__inner", COMPOSER, 15_000);
      expect.eq(
        idle0.got,
        idle0.want,
        "REQ-824: idle, the stage's composer has the customer's border and background",
      );
      const chipIdle = await customer("#chip", CHIP);
      expect.eq(
        (await same("#chip", CHIP, 2_000)).got,
        chipIdle,
        "idle, the stage's chip has the customer's look",
      );
      const searchShot = () => page.locator("#search").screenshot();
      const stageSearchShot = () =>
        stagePage.frameLocator(STAGE).locator("#search").screenshot();
      const inkIdle = await inkRight(page, await searchShot());
      const stageInkIdle = await inkRight(page, await stageSearchShot());

      // 1. the customer clicks into the composer: focused (its 160 ms border transition run out)
      await page.locator(".composer__input").click();
      await page.waitForTimeout(400);
      const focused = await customer(".composer__inner", COMPOSER);
      expect(
        focused !== idle,
        `the app's :focus-within rule changes the customer's composer (${idle} → ${focused})`,
      );
      const f1 = await same(".composer__inner", COMPOSER, 1_000);
      await stagePage.screenshot({ path: `${folder}/focus-1-stage.png` });
      await page.screenshot({ path: `${folder}/focus-1-customer.png` });
      expect.eq(
        f1.got,
        focused,
        "REQ-824: focused, the stage's composer computes the customer's green border and white fill within 1 s",
      );

      // 2. her mouse over the '2–3 days' chip: hovered (the composer keeps its focus)
      await page.locator("#chip").hover();
      await page.waitForTimeout(400);
      const chipHover = await customer("#chip", CHIP);
      expect(
        chipHover !== chipIdle,
        `the app's :hover rule changes the customer's chip (${chipIdle} → ${chipHover})`,
      );
      expect.eq(
        (await same("#chip", CHIP, 1_000)).got,
        chipHover,
        "REQ-824: the hovered chip has the customer's border on the stage within 1 s",
      );
      expect.eq(
        await stage(".composer__inner", COMPOSER),
        focused,
        "the stage's composer is still focused (a hover moves no focus)",
      );

      // 3. she clicks into the search box (the composer is blurred) and moves her mouse away: the
      //    × shows on her screen because the box is focused — and on the stage
      await page.locator("#search").click();
      await page.mouse.move(VIEW.width - 5, VIEW.height - 5);
      await page.waitForTimeout(400);
      expect.eq(
        (await same(".composer__inner", COMPOSER, 1_000)).got,
        idle,
        "REQ-824: blurred, the stage's composer is idle again, as the customer's",
      );
      expect.eq(
        (await same("#chip", CHIP, 1_000)).got,
        chipIdle,
        "the mouse gone, the stage's chip is idle again",
      );
      const xInk = await inkRight(page, await searchShot());
      expect(
        xInk > inkIdle + 15,
        `the customer's focused search box shows its × (${inkIdle} → ${xInk} dark px)`,
      );
      const stageInk = await until(
        async () => inkRight(page, await stageSearchShot()),
        (n) => Math.abs(n - xInk) <= 6,
        1_500,
      );
      await stagePage.screenshot({ path: `${folder}/search-x-stage.png` });
      await page.screenshot({ path: `${folder}/search-x-customer.png` });
      expect(
        Math.abs(stageInk - xInk) <= 6 && stageInk > stageInkIdle + 15,
        `REQ-824: the stage's search box shows the × too (stage ${stageInkIdle} → ${stageInk} dark px, customer ${xInk})`,
      );

      // 4. a mouse click focuses "Before" (no visible focus); Tab moves to "Plain" (a visible
      //    focus: the UA's ring) — the same on the stage
      await page.locator("#before").click();
      await page.mouse.move(VIEW.width - 5, VIEW.height - 5);
      await page.waitForTimeout(200);
      const noRing = await customer("#before", RING);
      expect.eq(
        (await same("#before", RING, 1_000)).got,
        noRing,
        "REQ-824: a mouse-focused button shows no ring on the stage, as on the customer's screen",
      );
      await page.keyboard.press("Tab");
      await page.waitForTimeout(200);
      const ring = await customer("#plain", RING);
      expect(
        (ring ?? "").startsWith("auto"),
        `a keyboard focus draws the UA's ring on the customer's button (${ring})`,
      );
      expect.eq(
        (await same("#plain", RING, 1_000)).got,
        ring,
        "REQ-824: a keyboard-focused button draws the same focus ring on the stage within 1 s",
      );
      // and the ring is painted, not just computed: the same blue pixels around the buttons
      const ringInk = await ink(
        page,
        await page.locator("p").screenshot(),
        "ring",
      );
      const stageRingInk = await ink(
        page,
        await stagePage.frameLocator(STAGE).locator("p").screenshot(),
        "ring",
      );
      await stagePage.screenshot({ path: `${folder}/ring-stage.png` });
      await page.screenshot({ path: `${folder}/ring-customer.png` });
      expect(
        ringInk > 20 && Math.abs(stageRingInk - ringInk) <= 4,
        `REQ-824: the stage paints the customer's focus ring (${ringInk} ring px on hers, ${stageRingInk} on the stage)`,
      );
      expect.eq(
        await stage("#before", RING),
        noRing,
        "the button focus left shows no ring on the stage",
      );
    } finally {
      await stagePage.close();
    }
  }));

// ---- 2. a real demo: the /assistant composer ----

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

const FRAME = "[data-cy='demo-frame']";

Deno.test("REQ-824 (cycle dm1, m2): during a demo the customer clicks into the /assistant composer — the stage frame's composer computes her focused border and background within 1.5 s, and her idle look again once she clicks away", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Maria Lopez" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Maria Lopez",
      businessName: "Lopez Painting LLC",
    });
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
    expect.eq(boot.status, 200, "the admin phone is a super admin");
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    try {
      await useCookie(userCtx, baseUrl, user.cookie);
      const userPage = await userCtx.newPage();

      // the presenter opens the demo on Maria's account
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

      // Maria is on her assistant (its composer takes the focus as it loads: blurred first, so
      // the test starts from her idle look); the stage mirrors it, styled
      await userPage.goto(`${baseUrl}/assistant`);
      const input = userPage.locator(".composer__input").first();
      await input.waitFor({ state: "visible", timeout: 20_000 });
      await userPage.mouse.move(1270, 790);
      const blur = () =>
        userPage.evaluate(() =>
          (document.activeElement as HTMLElement | null)?.blur()
        );
      await blur();
      await userPage.waitForTimeout(400);
      const mine = () => lookIn(userPage, ".composer__inner", COMPOSER);
      const theirs = () =>
        lookInFrame(page, FRAME, ".composer__inner", COMPOSER);
      const idle = await mine();
      expect.eq(
        await until(theirs, (v) => v === idle, 30_000),
        idle,
        "REQ-824: idle, the stage frame's composer has Maria's border and background",
      );

      // she clicks into the composer
      await input.click();
      await userPage.mouse.move(1270, 790);
      await userPage.waitForTimeout(400); // her 160 ms border transition runs out
      const focused = await mine();
      expect(
        focused !== idle,
        `the composer's :focus-within look differs from its idle one (${idle} → ${focused})`,
      );
      const clicked = Date.now();
      const got = await until(theirs, (v) => v === focused, 1_500);
      const took = Date.now() - clicked;
      await page.screenshot({ path: `${folder}/demo-composer-stage.png` })
        .catch(() => {});
      await userPage.screenshot({
        path: `${folder}/demo-composer-customer.png`,
      }).catch(() => {});
      expect.eq(
        got,
        focused,
        `REQ-824: the stage frame's composer computes Maria's focused border and background within 1.5 s (${took} ms after her look settled)`,
      );

      // she clicks away: idle on both screens again
      await blur();
      await userPage.waitForTimeout(400);
      expect.eq(await mine(), idle, "Maria's composer is idle again");
      expect.eq(
        await until(theirs, (v) => v === idle, 1_500),
        idle,
        "REQ-824: the stage frame's composer is idle again within 1.5 s",
      );
    } finally {
      await userCtx.close();
    }
  }));
