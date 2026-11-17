/**
 * REQ-890 AMENDMENT 6 (demo-loop run 16, p5 + p4; by hand) — End's click guard (REQ-890
 * AMENDMENT 4: a click where the pointer opened the peek is the tab's) follows the gesture, not a
 * single point.
 *  p5 — a mouse reaching the right-docked tab at 390 px in five ~14 px steps opened the peek on
 *       its first step; the later steps took the pointer past 8 px of that point, so the click at
 *       the end of the same approach asked "End the demo with Alex?". The approach that opened the
 *       peek goes on through its continuous moves inside the tab's box: the click at its end is
 *       the tab's. A move after a rest is deliberate: End is End.
 *  p4 — at 1280×800 "Seguir" shrank the question pill back and End landed under the still
 *       mouse: "a second click only asks again". A click where the mouse rests after Keep going,
 *       before it moves on, is not End's.
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
// deno-lint-ignore no-explicit-any
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

/** Maria (onboarded, in `lang`) on `path` at `view` with the pill folded; Alex on /admin, the
 *  demo on */
async function setUp(
  // deno-lint-ignore no-explicit-any
  page: any,
  http: StoryTools["http"],
  baseUrl: string,
  path: string,
  view: { width: number; height: number },
  lang: "en" | "es" = "en",
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
  const userCtx = await browser.newContext({ viewport: view });
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
  return {
    box: r ? [r.left, r.top, r.width, r.height].map(Math.round) : null,
    tucked: pill?.hasAttribute("data-tucked") ?? null,
    peek: pill?.hasAttribute("data-peek") ?? null,
    under: b
      ? (b.getAttribute("data-cy") ?? b.textContent?.trim())
      : (e?.getAttribute("data-cy") ?? e?.tagName ?? null),
    inPill: !!(pill && e && pill.contains(e)),
    asking: !!document.querySelector("[data-cy='demo-end-ask']"),
  };
};

Deno.test("REQ-890 AMENDMENT 6 (demo-loop run 16, p5): 390×844 /dashboard, the right-docked tab — a mouse reaching 'Demo' in five ~14 px steps, a 0.5 s rest and a click: the click is the tab's (no End question); a deliberate move onto End after the rest asks", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx, tab } = await setUp(page, http, baseUrl, "/dashboard", {
      width: 390,
      height: 844,
    });
    try {
      const tb = (await tab.evaluate(state, [0, 0] as [number, number])).box!;
      expect(tb[0] > 100, `the tab is right-docked (${JSON.stringify(tb)})`);
      // tester 4's approach: (tab.left-25, tab.top-44) → (tab.left+15, tab.top+16) in 5 steps
      const sx = tb[0] - 25, sy = tb[1] - 44;
      const ex = tb[0] + 15, ey = tb[1] + 16;
      await tab.mouse.move(sx, sy);
      for (let i = 1; i <= 5; i++) {
        await tab.mouse.move(sx + (ex - sx) * i / 5, sy + (ey - sy) * i / 5);
        await tab.waitForTimeout(30);
      }
      await tab.waitForTimeout(500);
      const rested = await tab.evaluate(state, [ex, ey] as [number, number]);
      await tab.screenshot({ path: `${folder}/approach-rested-390.png` });
      expect(
        rested.peek === true,
        `the approach opened the peek (${JSON.stringify(rested)})`,
      );
      await tab.mouse.down();
      await tab.mouse.up();
      await tab.waitForTimeout(500);
      const clicked = await tab.evaluate(state, [ex, ey] as [number, number]);
      expect(
        !clicked.asking,
        `p5: the click at the end of the approach that opened the peek is the tab's — no End question (under the mouse: ${rested.under}; ${
          JSON.stringify(clicked)
        })`,
      );
      // after a rest, a deliberate move onto End: End is End
      const endBox = await tab.locator("[data-cy='demo-end']").boundingBox();
      expect(endBox !== null, "End is on the peek");
      await tab.waitForTimeout(400);
      await tab.mouse.move(
        endBox!.x + endBox!.width / 2,
        endBox!.y + endBox!.height / 2,
        { steps: 4 },
      );
      await tab.waitForTimeout(150);
      await tab.mouse.down();
      await tab.mouse.up();
      await tab.locator("[data-cy='demo-end-ask']").waitFor({ timeout: 5_000 });
      await tab.locator("[data-cy='demo-end-cancel']").click();
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-890 AMENDMENT 6 (demo-loop run 16, p4): 1024×768, ES /settings, the right-docked tab — End asks, 'Seguir' shrinks the pill and 'Terminar demo' lands under the still mouse: a click there, before the mouse moves, does not ask again; after a move it does", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    // the tester saw it at 1280×800 on a right-docked pill; at 1280 /dashboard docks the tab on
    // the LEFT (the shrunk pill folds away from the mouse), so the right-docked geometry of
    // REQ-820 AMENDMENT 5's story is used: the 671 px question, Seguir at its right end, the
    // 444 px pill back flush with the right edge — End under the mouse
    const { userCtx, tab } = await setUp(page, http, baseUrl, "/settings", {
      width: 1024,
      height: 768,
    }, "es");
    try {
      const tb = (await tab.evaluate(state, [0, 0] as [number, number])).box!;
      const mx = tb[0] + 20, my = tb[1] + 16;
      await tab.mouse.move(mx, my + 100);
      await tab.mouse.move(mx, my);
      await tab.waitForTimeout(600);
      const endBox = await tab.locator("[data-cy='demo-end']").boundingBox();
      if (!endBox) {
        throw new Error(
          "no End on the peek: " +
            JSON.stringify(await tab.evaluate(state, [mx, my] as [number, number])),
        );
      }
      await tab.waitForTimeout(400);
      await tab.mouse.move(
        endBox.x + endBox.width / 2,
        endBox.y + endBox.height / 2,
        { steps: 3 },
      );
      await tab.mouse.down();
      await tab.mouse.up();
      await tab.locator("[data-cy='demo-end-ask']").waitFor({ timeout: 5_000 });
      await tab.waitForTimeout(600);
      const no = await tab.locator("[data-cy='demo-end-cancel']").boundingBox();
      if (!no) throw new Error("no Keep going");
      const nx = no.x + no.width / 2, ny = no.y + no.height / 2;
      await tab.mouse.move(nx, ny, { steps: 3 });
      await tab.mouse.down();
      await tab.mouse.up();
      await tab.locator("[data-cy='demo-end-ask']").waitFor({
        state: "detached",
        timeout: 5_000,
      });
      await tab.waitForTimeout(600);
      const after = await tab.evaluate(state, [nx, ny] as [number, number]);
      await tab.screenshot({ path: `${folder}/after-seguir-1024.png` });
      await Deno.writeTextFile(
        `${folder}/after-keep-going.json`,
        JSON.stringify({ tb, endBox, no, after }, null, 1),
      );
      expect(
        after.under === "demo-end",
        `the tester's case: End came back under the still mouse at (${nx},${ny}) (${
          JSON.stringify(after)
        })`,
      );
      // the second click, the mouse still where Keep going was
      await tab.mouse.down();
      await tab.mouse.up();
      await tab.waitForTimeout(500);
      const clicked = await tab.evaluate(state, [nx, ny] as [number, number]);
      expect(
        !clicked.asking,
        `p4: a click where the mouse rests after Keep going is not End's (under it: ${after.under}; ${
          JSON.stringify(clicked)
        })`,
      );
      // the mouse moves on and comes back to End: End is End again
      await tab.waitForTimeout(400);
      await tab.mouse.move(nx - 40, ny + 30, { steps: 3 });
      await tab.mouse.move(nx, ny, { steps: 3 });
      await tab.waitForTimeout(150);
      await tab.mouse.down();
      await tab.mouse.up();
      await tab.locator("[data-cy='demo-end-ask']").waitFor({
        timeout: 5_000,
      });
      await tab.locator("[data-cy='demo-end-cancel']").click();
    } finally {
      await userCtx.close();
    }
  }));
