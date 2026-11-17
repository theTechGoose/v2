/**
 * REQ-647 (demo-loop cycle 5, issues m29 + m23 + c2-p13-r) — the end of a demo is said however it
 * is learned, survives a page load, and a restart after it is said long enough to be read.
 *
 *   1. Ana's app never gets its socket (routeWebSocket: the `ended` frame cannot arrive), so it
 *      only knows the demo by /active. Hans opens a demo for her and ends it. Her pill turns into
 *      "The demo ended" (m29: it used to vanish with no word); a reload keeps saying it; Hans's
 *      next demo says "Hans started a new demo" and still says it 6 s later (m23: it lasted 4 s).
 *   2. /admin?demo=ended&by=you (where a stage hands its presenter back) shows "You ended the
 *      demo" in the server's own HTML — a page whose islands never hydrate still says it
 *      (c2-p13-r) — and, hydrated, keeps it with the address made bare.
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

async function people(http: StoryTools["http"], expect: StoryTools["expect"]) {
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
  return { user, admin };
}

Deno.test("REQ-647 (cycle 5, m29 + m23): an end the customer's socket never hears is still said, survives a reload, and the next demo says 'started a new demo' for longer than 4 s", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { user, admin } = await people(http, expect);
    const userId = user.body.userId as string;
    expect(!!userId, "Ana's user id");
    const ctx = page.context();
    await useCookie(ctx, baseUrl, user.cookie);
    await page.setViewportSize({ width: 1280, height: 800 });
    // the socket never reaches the server: no `ended` frame, no presence — only /active
    await page.routeWebSocket(/\/demo-mode\/ws/, () => {});
    await page.goto(`${baseUrl}/dashboard`);

    const open = async () => {
      const r = await http("/api/demo-mode/sessions", {
        method: "POST",
        headers: admin.auth,
        body: JSON.stringify({ userId }),
      });
      expect(r.status === 200 || r.status === 201, `demo opened (${r.status})`);
      return (await r.json()).id as string;
    };
    const end = async (id: string) => {
      const r = await http(`/api/demo-mode/sessions/${id}/end`, {
        method: "POST",
        headers: admin.auth,
      });
      expect.eq(r.status, 200, "Hans ended the demo");
      await r.body?.cancel();
    };

    const first = await open();
    await page.locator("[data-cy='demo-pill']").waitFor({
      state: "attached",
      timeout: 20_000,
    });
    await end(first);
    // the poll (every 5 s while not connected) learns it: the notice, never a silent vanish
    await page.locator("[data-cy='demo-ended']").waitFor({ timeout: 15_000 });
    expect(
      (await page.locator("[data-cy='demo-ended']").innerText()).includes(
        "The demo ended",
      ),
      "m29: the pill turned into 'The demo ended'",
    );
    expect.eq(
      await page.locator("[data-cy='demo-pill']").count(),
      0,
      "the pill is gone; the notice stands in its place",
    );

    // a page load keeps it (REQ-535's slot carries the end)
    const slot = await page.evaluate(() =>
      sessionStorage.getItem("pm:demo-pill")
    );
    expect(
      (slot ?? "").includes('"ended"'),
      `the tab keeps the end for its next page (${slot})`,
    );
    await page.reload();
    await page.locator("[data-cy='demo-ended']").waitFor({ timeout: 15_000 });
    expect(
      (await page.locator("[data-cy='demo-ended']").innerText()).includes(
        "The demo ended",
      ),
      "m29: after a reload the notice is still there",
    );

    // the next demo is a restart, said long enough to read
    const restarted = page.locator("[data-cy='demo-restarted']");
    const said = restarted.waitFor({ timeout: 20_000 }).then(
      () => restarted.innerText(),
      () => null,
    );
    const second = await open();
    expect.eq(
      (await said)?.trim() ?? null,
      "Hans started a new demo",
      "m23: the customer's pill says a new demo started",
    );
    await page.waitForTimeout(6_000);
    expect.eq(
      await restarted.count(),
      1,
      "m23: 6 s later (no input) it still says so — it used to go after 4 s",
    );
    await end(second);
  }));

Deno.test("REQ-647 (cycle 5, c2-p13-r): /admin?demo=ended&by=you says 'You ended the demo' on first paint — in the server's HTML, and kept once hydrated", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { admin } = await people(http, expect);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    // the server's HTML alone: no script runs, nothing hydrates
    const bare = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 800 },
    });
    try {
      await useCookie(bare, baseUrl, admin.cookie);
      const p = await bare.newPage();
      await p.goto(`${baseUrl}/admin?demo=ended&by=you`);
      const n = p.locator("[data-cy='demo-ended']");
      await n.waitFor({ timeout: 5_000 });
      expect(
        (await n.innerText()).includes("You ended the demo"),
        "c2-p13-r: the server render paints the notice",
      );
      expect(await n.isVisible(), "and it is visible");
    } finally {
      await bare.close();
    }

    await useCookie(page.context(), baseUrl, admin.cookie);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${baseUrl}/admin?demo=ended&by=you`);
    const n = page.locator("[data-cy='demo-ended']");
    await n.waitFor({ timeout: 5_000 });
    await page.locator("[data-cy='adm-q']").waitFor({ timeout: 15_000 });
    await page.waitForFunction(() => location.search === "", null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(3_000);
    expect(
      (await n.innerText()).includes("You ended the demo"),
      "hydrated, the notice stays",
    );
    await page.locator("[data-cy='demo-ended-dismiss']").click();
    await n.waitFor({ state: "hidden", timeout: 2_000 });
  }));
