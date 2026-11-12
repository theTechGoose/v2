/**
 * REQ-235 — the end of a demo is said on both sides and stays; End asks first (the 20-agent
 * demo's issue demo-lifecycle-m2). Two browsers: Hans (a super admin) opens a demo for Ana from
 * /admin and lands on the stage; Ana's app joins on its own; both connect.
 *
 *   1. Ana clicks End: it asks "End for everyone?" and nothing has ended; Keep going puts End
 *      back; asked and left alone, End comes back by itself after 4 s — the demo still on.
 *   2. Ana ends it (End, Yes): her pill turns at once — before the server answers — into "You
 *      ended the demo"; Hans's stage lands on /admin, which says "Ana Torres ended the demo" with
 *      the address bare; seconds later both are still there; dismissed, a reload does not repeat it.
 *   3. Again, Hans ends it from his stage (End, Yes): the stage says "The demo ended" at once;
 *      /admin says "You ended the demo"; Ana's screen says "Hans ended the demo" and keeps saying
 *      it until she dismisses it.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** the demo agents looked every 10–20 s; the old chip lived 0.8–1.5 s. A notice that is still
 *  there this long after is one a person reads. */
const LASTING_MS = 5_000;

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

Deno.test("REQ-235: End asks first — Keep going, or 4 s, puts it back and the demo goes on; the customer's End says 'You ended the demo' at once on her screen and 'Ana Torres ended the demo' on /admin, both lasting; the staff's End says 'You ended the demo' on /admin and 'Hans ended the demo' on hers until she dismisses it", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await setName(http, user.auth, "Ana Torres");
    const admin = await verify(http, adminPhone);
    await setName(http, admin.auth, "Hans");
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    expect.eq(boot.status, 200, "Hans is a super admin");
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, admin.cookie);

      /** is Ana's demo still on, by the server */
      const live = async () => {
        const r = await http("/api/demo-mode/active", { headers: user.auth });
        return (await r.json()).session !== null;
      };
      /** Hans clicks Demo on Ana's row and lands on the stage; Ana's app joins; both connect */
      const openDemo = async () => {
        await page.goto(`${baseUrl}/admin`);
        await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
        await page.locator("[data-cy='adm-search']").click();
        await page.locator("[data-cy='adm-demo']").first().waitFor({
          timeout: 15_000,
        });
        await page.locator("[data-cy='adm-demo']").first().click();
        await page.waitForURL((u) => u.pathname === "/demo/stage", {
          timeout: 20_000,
        });
        // a page that saw a demo end stops asking for a new one (M11, its own issue): reload
        await userPage.reload();
        for (const pg of [page, userPage]) {
          await pg.locator("[data-cy='demo-status']").filter({
            hasText: /direct|relay/,
          }).waitFor({ timeout: 20_000 });
        }
      };
      const textOf = async (pg: typeof page, cy: string) =>
        (await pg.locator(`[data-cy='${cy}']`).innerText()).trim();

      await openDemo();

      // 1. End asks first: nothing has ended. Keep going puts End back
      await userPage.locator("[data-cy='demo-end']").click();
      await userPage.locator("[data-cy='demo-end-ask']").waitFor({
        timeout: 2_000,
      });
      expect(
        (await textOf(userPage, "demo-end-ask")).includes("End for everyone?"),
        "the first click asks: End for everyone?",
      );
      expect.eq(
        await userPage.locator("[data-cy='demo-end']").count(),
        0,
        "End has turned into the question",
      );
      expect(await live(), "asking ended nothing: the demo is still on");
      await userPage.locator("[data-cy='demo-end-cancel']").click();
      await userPage.locator("[data-cy='demo-end']").waitFor({
        timeout: 2_000,
      });
      expect(await live(), "Keep going: the demo is still on");
      // asked and left alone: End comes back by itself after 4 s
      await userPage.locator("[data-cy='demo-end']").click();
      const asked = Date.now();
      await userPage.locator("[data-cy='demo-end-ask']").waitFor({
        timeout: 2_000,
      });
      await userPage.locator("[data-cy='demo-end']").waitFor({
        timeout: 8_000,
      });
      const gone = Date.now() - asked;
      expect(
        gone >= 3_500 && gone <= 6_500,
        `the unanswered question went away on its own after ${gone} ms (4 s)`,
      );
      expect(await live(), "unanswered: the demo is still on");
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /direct|relay/,
      }).waitFor({ timeout: 5_000 });

      // 2. Ana ends it: her pill turns into the notice AT ONCE — the server's answer held back
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      await userPage.route("**/api/demo-mode/sessions/*/end", async (route) => {
        await held;
        await route.continue();
      }, { times: 1 });
      await userPage.locator("[data-cy='demo-end']").click();
      await userPage.locator("[data-cy='demo-end-confirm']").click();
      await userPage.locator("[data-cy='demo-ended']").waitFor({
        timeout: 1_000,
      });
      expect(
        (await textOf(userPage, "demo-ended")).includes("You ended the demo"),
        "REQ-179: the customer's own End says so at once, before the server answers",
      );
      expect.eq(
        await userPage.locator("[data-cy='demo-pill']").count(),
        0,
        "the pill is gone; the notice stands in its place",
      );
      release();
      // Hans's stage hands him his own account back, and /admin says who ended it
      await page.waitForURL((u) => u.pathname === "/admin", {
        timeout: 20_000,
      });
      await page.locator("[data-cy='demo-ended']").waitFor({ timeout: 15_000 });
      expect(
        (await textOf(page, "demo-ended")).includes(
          "Ana Torres ended the demo",
        ),
        "/admin says the customer ended it, by name",
      );
      expect.eq(
        new URL(page.url()).search,
        "",
        "read once: the address is a bare /admin again",
      );
      await page.locator("[data-cy='adm-q']").waitFor({ timeout: 15_000 });
      await sleep(LASTING_MS);
      expect(
        (await textOf(userPage, "demo-ended")).includes("You ended the demo"),
        `the customer's notice is still there ${LASTING_MS / 1000} s later`,
      );
      expect(
        (await textOf(page, "demo-ended")).includes(
          "Ana Torres ended the demo",
        ),
        `/admin's notice is still there ${LASTING_MS / 1000} s later`,
      );
      // the frames: /admin's notice (a stamped action), and the customer's screen beside it
      await page.locator("[data-cy='demo-ended']").hover();
      await userPage.screenshot({ path: `${folder}/customer-you-ended.png` });
      expect(!(await live()), "the demo is over on the server");
      await page.locator("[data-cy='demo-ended-dismiss']").click();
      await page.locator("[data-cy='demo-ended']").waitFor({
        state: "hidden",
        timeout: 2_000,
      });
      await page.reload();
      await page.locator("[data-cy='adm-q']").waitFor({ timeout: 15_000 });
      await sleep(1_000);
      expect.eq(
        await page.locator("[data-cy='demo-ended']").count(),
        0,
        "dismissed, a reload does not say it again",
      );

      // 3. again — Hans ends it from his stage
      await openDemo();
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-ask']").waitFor({
        timeout: 2_000,
      });
      expect(
        (await textOf(page, "demo-end-ask")).includes("End for everyone?"),
        "the stage asks too",
      );
      await page.locator("[data-cy='demo-end-confirm']").click();
      await page.locator("[data-cy='demo-status']").filter({
        hasText: "The demo ended",
      }).waitFor({ timeout: 1_000 });
      await userPage.locator("[data-cy='demo-ended']").waitFor({
        timeout: 15_000,
      });
      expect(
        (await textOf(userPage, "demo-ended")).includes("Hans ended the demo"),
        "the customer's screen names the presenter who ended it",
      );
      await page.waitForURL((u) => u.pathname === "/admin", {
        timeout: 20_000,
      });
      await page.locator("[data-cy='demo-ended']").waitFor({ timeout: 15_000 });
      expect(
        (await textOf(page, "demo-ended")).includes("You ended the demo"),
        "/admin says this presenter ended it",
      );
      await sleep(LASTING_MS);
      expect(
        (await textOf(userPage, "demo-ended")).includes("Hans ended the demo"),
        `the customer's notice is still there ${LASTING_MS / 1000} s later`,
      );
      expect(
        (await textOf(page, "demo-ended")).includes("You ended the demo"),
        `/admin's notice is still there ${LASTING_MS / 1000} s later`,
      );
      await page.locator("[data-cy='demo-ended']").hover();
      await userPage.screenshot({ path: `${folder}/customer-hans-ended.png` });
      await userPage.locator("[data-cy='demo-ended-dismiss']").click();
      await userPage.locator("[data-cy='demo-ended']").waitFor({
        state: "hidden",
        timeout: 2_000,
      });
      expect(!(await live()), "the demo is over on the server");
    } finally {
      await userCtx.close();
    }
  }));
