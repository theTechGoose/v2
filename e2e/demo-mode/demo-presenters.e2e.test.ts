/**
 * REQ-214 — several staff present at once, each with a name and a colour: three browsers. Hans
 * opens a demo for Ana and lands on the stage; Lia clicks Demo on the same Ana and lands on her
 * own stage, in the same demo. Ana's pill names both presenters with two colour dots of
 * different colours; each stage lists both presenters. Lia moves over her frame: Ana's screen
 * shows a pointer tagged "Lia" in Lia's colour; Hans moves: a second pointer tagged "Hans" in a
 * different colour, and Hans's stage shows Lia's pointer. End from Hans clears all three.
 * REQ-242 — each stage's frame mirrors Ana's document; its page is the frame's `data-path`.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const FRAME = "[data-cy='demo-frame']";

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

async function until(
  what: string,
  cond: () => boolean | Promise<boolean>,
  timeout = 15_000,
) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await cond()) return;
    } catch {
      // mid-navigation; ask again
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${what}`);
}

async function setName(
  http: StoryTools["http"],
  auth: Record<string, string>,
  name: string,
) {
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name }),
  })).body?.cancel();
}

async function bootstrap(http: StoryTools["http"], phone: string) {
  const r = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone }),
  });
  await r.body?.cancel();
  return r.status;
}

Deno.test("REQ-214: two staff present to one customer — Lia's Demo on an already-guided Ana joins Hans's demo; Ana's pill names both with two colours; each presenter's pointer shows on Ana's screen in their colour; Hans's stage shows Lia's pointer; End from Hans clears all three", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const hansPhone = `+1843${digits()}`;
    const liaPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await setName(http, user.auth, "Ana Torres");
    const hans = await verify(http, hansPhone);
    await setName(http, hans.auth, "Hans");
    const lia = await verify(http, liaPhone);
    await setName(http, lia.auth, "Lia");
    expect.eq(await bootstrap(http, hansPhone), 200, "Hans is a super admin");
    expect.eq(await bootstrap(http, liaPhone), 200, "Lia is a super admin too");

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    const liaCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/dashboard`);

      const openDemo = async (pg: typeof page) => {
        await pg.goto(`${baseUrl}/admin`);
        await pg.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
        await pg.locator("[data-cy='adm-search']").click();
        await pg.locator("[data-cy='adm-demo']").first().waitFor({
          timeout: 15_000,
        });
        await pg.locator("[data-cy='adm-demo']").first().click();
        await pg.waitForURL((u) => u.pathname === "/demo/stage", {
          timeout: 20_000,
        });
        await pg.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
      };

      // 1. Hans opens the demo; Ana's app joins on its own
      await useCookie(page.context(), baseUrl, hans.cookie);
      await openDemo(page);
      await userPage.reload();
      await userPage.locator("[data-cy='demo-status']").waitFor({
        timeout: 15_000,
      });
      expect(
        (await userPage.locator("[data-cy='demo-pill']").innerText()).includes(
          "Hans is guiding you",
        ),
        "one presenter: the pill names Hans",
      );

      // 2. Lia clicks Demo on the same Ana: her browser lands on a stage of the same demo
      const liaPage = await liaCtx.newPage();
      await useCookie(liaCtx, baseUrl, lia.cookie);
      await openDemo(liaPage);
      // REQ-232 (demo-lifecycle-p1) — both stages say plainly that they are live
      await liaPage.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Live\s*$/,
      }).waitFor({ timeout: 20_000 });
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Live\s*$/,
      }).waitFor({ timeout: 20_000 });

      // Ana's pill names both, with two colour dots of different colours
      const chipColors = (pg: typeof page) =>
        pg.locator("[data-cy='demo-presenter']").evaluateAll((els) =>
          els.map((el) => ({
            name: (el.textContent ?? "").trim(),
            color: (el as HTMLElement).dataset.color ?? "",
          }))
        );
      await until(
        "Ana's pill lists both presenters",
        async () => (await chipColors(userPage)).length === 2,
      );
      const chips = await chipColors(userPage);
      const pill = await userPage.locator("[data-cy='demo-pill']").innerText();
      expect(
        pill.includes("Hans") && pill.includes("Lia"),
        `the pill names both presenters (${pill})`,
      );
      expect(
        chips[0].color !== chips[1].color && chips.every((c) => c.color),
        `two different colours: ${JSON.stringify(chips)}`,
      );
      const colorOf = (name: string) =>
        chips.find((c) => c.name.startsWith(name))?.color ?? "";
      expect(colorOf("Hans") !== "", "Hans has a colour");
      expect(colorOf("Lia") !== "", "Lia has a colour");
      // each stage lists both presenters too
      await until(
        "Hans's stage lists both presenters",
        async () => (await chipColors(page)).length === 2,
      );
      await until(
        "Lia's stage lists both presenters",
        async () => (await chipColors(liaPage)).length === 2,
      );

      // 3. Lia moves over her frame: Ana's screen shows a pointer tagged Lia in Lia's colour
      const frameBox = async (pg: typeof page) => {
        const b = await pg.locator("[data-cy='demo-frame']").boundingBox();
        if (!b) throw new Error("no frame box");
        return b;
      };
      const pointers = (pg: typeof page) =>
        pg.locator("[data-cy='demo-pointer']").evaluateAll((els) =>
          els.map((el) => ({
            name: (el as HTMLElement).dataset.presenter ?? "",
            color: el.querySelector("path")?.getAttribute("fill") ?? "",
          }))
        );
      const lb = await frameBox(liaPage);
      await liaPage.mouse.move(lb.x + lb.width * 0.3, lb.y + lb.height * 0.3);
      await liaPage.mouse.move(lb.x + lb.width * 0.35, lb.y + lb.height * 0.35);
      await until(
        "Ana sees Lia's pointer in Lia's colour",
        async () =>
          (await pointers(userPage)).some((p) =>
            p.name === "Lia" && p.color === colorOf("Lia")
          ),
      );
      // Hans's stage shows Lia's pointer too
      await until(
        "Hans's stage shows Lia's pointer",
        async () => (await pointers(page)).some((p) => p.name === "Lia"),
      );
      // 4. Hans moves: a second pointer on Ana's screen, tagged Hans, in a different colour
      const hb = await frameBox(page);
      await page.mouse.move(hb.x + hb.width * 0.6, hb.y + hb.height * 0.6);
      await page.mouse.move(hb.x + hb.width * 0.65, hb.y + hb.height * 0.65);
      await until(
        "Ana sees Hans's pointer in Hans's colour, next to Lia's",
        async () => {
          const ps = await pointers(userPage);
          return ps.some((p) =>
            p.name === "Hans" && p.color === colorOf("Hans")
          ) &&
            ps.some((p) => p.name === "Lia");
        },
      );
      const ps = await pointers(userPage);
      expect.eq(ps.length, 2, "two pointers on Ana's screen");
      expect(ps[0].color !== ps[1].color, "in two different colours");
      // frame sanity: both stages mirror Ana's page (REQ-242)
      const framePath = (pg: typeof page) =>
        pg.locator(FRAME).getAttribute("data-path");
      const customerPath = new URL(userPage.url()).pathname;
      expect.eq(
        await framePath(page),
        customerPath,
        "Hans's frame is on Ana's page",
      );
      expect.eq(
        await framePath(liaPage),
        customerPath,
        "Lia's frame is on Ana's page",
      );

      // 5. End from Hans clears all three (REQ-235: End, then Yes)
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      await userPage.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
      await liaPage.waitForURL(/\/admin/, { timeout: 20_000 });
      const active = await http("/api/demo-mode/active", {
        headers: user.auth,
      });
      expect.eq((await active.json()).session, null, "the demo is over");
    } finally {
      await userCtx.close();
      await liaCtx.close();
    }
  }));
