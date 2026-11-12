/**
 * REQ-222 (demo issue M11) — after a CONNECTED demo ends, the customer's app keeps asking the
 * server, so a new demo reaches it without a reload: Hans opens a demo for Ana, Ana's app joins
 * and connects; Hans ends it, Ana's pill goes; Hans opens a new one and Ana's app — never
 * reloaded — joins it within the 5 s poll. Then Ana ends it from her own pill, Hans opens a third,
 * and Ana's app joins that one too.
 * REQ-298 (demo-loop cycle 1, M5 + M17) — each restart is SAID on Ana's side: her pill reads
 * "Hans started a new demo" when the next demo reaches her, never a silent swap of the notice.
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

Deno.test("REQ-222 (M11) + REQ-298: a connected demo ends — from the staff side, then from the customer's — and a new demo reaches the customer's app within the 5 s poll, with no reload, said as a new demo", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const hansPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await setName(http, user.auth, "Ana Torres");
    const hans = await verify(http, hansPhone);
    await setName(http, hans.auth, "Hans");
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: hansPhone }),
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
      await useCookie(page.context(), baseUrl, hans.cookie);
      // the customer's page loads ONCE: a reload would hide the bug
      let loads = 0;
      userPage.on("load", () => loads++);

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
        await page.locator("[data-cy='demo-pill']").waitFor({
          timeout: 15_000,
        });
      };
      /** both sides connected — the customer's poll is idle while this lasts (by design).
       *  REQ-232 (demo-lifecycle-p1): the pills say Connected (customer) and Live (staff) */
      const connected = async (what: string) => {
        // ACTIVE_POLL_MS (5 s) + the join + the WebRTC/relay handshake
        await userPage.locator("[data-cy='demo-status']").filter({
          hasText: /^\s*Connected\s*$/,
        }).waitFor({ timeout: 20_000 }).catch(() => {
          throw new Error(`${what}: the customer's app never connected`);
        });
        await page.locator("[data-cy='demo-status']").filter({
          hasText: /^\s*Live\s*$/,
        }).waitFor({ timeout: 20_000 });
      };
      /** REQ-235 — End asks first: Yes counts once armed (Playwright waits for it) */
      // deno-lint-ignore no-explicit-any
      const endFrom = async (p: any) => {
        await p.locator("[data-cy='demo-end']").click();
        await p.locator("[data-cy='demo-end-confirm']").click();
      };
      const pillGone = () =>
        userPage.locator("[data-cy='demo-pill']").waitFor({
          state: "hidden",
          timeout: 15_000,
        });

      // 1. a demo, connected
      await openDemo();
      await connected("the first demo");

      // 2. Hans ends it: Ana's pill goes; Hans is handed back /admin
      await endFrom(page);
      await pillGone();
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
      await page.locator("[data-cy='adm-q']").waitFor({ timeout: 20_000 });

      // 3. a new demo: Ana's app — not reloaded — joins on its own, and says it is a NEW one
      //    (REQ-298; the line stays a few seconds, so it is watched for from before the open)
      const restarted = userPage.locator("[data-cy='demo-restarted']");
      const said = restarted.waitFor({ timeout: 25_000 }).then(
        () => restarted.innerText(),
        () => null,
      );
      await openDemo();
      const line = await said;
      expect.eq(
        line,
        "Hans started a new demo",
        "REQ-298: the customer's pill says a new demo started, not a silent swap",
      );
      await connected("the demo after a staff End");

      // 4. Ana ends it from her own pill; a third demo reaches her too
      await endFrom(userPage);
      await pillGone();
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
      await page.locator("[data-cy='adm-q']").waitFor({ timeout: 20_000 });
      await openDemo();
      await connected("the demo after the customer's End");

      expect.eq(loads, 0, "the customer's page was never reloaded");

      await endFrom(page);
      await pillGone();
    } finally {
      await userCtx.close();
    }
  }));
