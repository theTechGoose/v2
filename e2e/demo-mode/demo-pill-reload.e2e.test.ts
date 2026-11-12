/**
 * REQ-535 (demo-loop cycle 4, m13) — the customer's pill survives a page load. The app has no
 * client-side navigation, so every link is a full load: the pill used to vanish until the first
 * /active answered, then say "Connecting…" for the 2-4 s the new socket and the stage's presence
 * took. Hans opens a demo for Ana; once Ana's pill says Connected, she reloads, then follows a
 * link to another page. Each time the pill — once drawn — never says "Connecting…" and never
 * goes away again, and it ends on Connected.
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

/** runs in every page of Ana's tab from its first byte: what the pill shows, every 40 ms */
const SAMPLER = `(() => {
  const log = [];
  window.__pillLog = log;
  const t0 = performance.now();
  const tick = () => {
    const pill = document.querySelector("[data-cy='demo-pill']");
    const st = document.querySelector("[data-cy='demo-status']");
    log.push({
      t: Math.round(performance.now() - t0),
      s: pill ? (st ? (st.textContent || "").trim() : "pill") : "none",
    });
  };
  setInterval(tick, 40);
})();`;

type Sample = { t: number; s: string };

/** what went wrong in a page load's samples, or null: once drawn the pill stays, never says
 *  Connecting…, and ends on Connected */
function judge(log: Sample[]): string | null {
  const first = log.findIndex((x) => x.s !== "none");
  if (first < 0) return "the pill never came back";
  const after = log.slice(first);
  const bad = after.find((x) => x.s !== "Connected");
  if (bad) {
    return `at ${bad.t} ms the pill said "${bad.s}" (first drawn at ${
      log[first].t
    } ms; ${after.map((x) => `${x.t}:${x.s}`).join(" ").slice(0, 600)})`;
  }
  return null;
}

Deno.test("REQ-535 (cycle 4, m13): a connected customer's pill survives a reload and a link to another page — never Connecting…, never gone once drawn", (t) =>
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
      viewport: { width: 1280, height: 800 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.addInitScript(SAMPLER);
      await userPage.goto(`${baseUrl}/dashboard`);

      await useCookie(page.context(), baseUrl, hans.cookie);
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

      const connected = (what: string) =>
        userPage.locator("[data-cy='demo-status']").filter({
          hasText: /^\s*Connected\s*$/,
        }).waitFor({ timeout: 25_000 }).catch(() => {
          throw new Error(`${what}: the customer's pill never said Connected`);
        });
      await connected("the demo");
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Live\s*$/,
      }).waitFor({ timeout: 20_000 });

      const watch = async (what: string) => {
        // the grace is ~5 s: watch the whole of it
        await userPage.waitForTimeout(5_500);
        // deno-lint-ignore no-explicit-any
        const log = await userPage.evaluate(() => (window as any).__pillLog);
        const wrong = judge(log as Sample[]);
        expect.eq(wrong, null, `REQ-535 ${what}`);
        await connected(what);
      };

      // 1. a reload of the same page
      await userPage.reload();
      await watch("after a reload");

      // 2. a link to another page (a full document load: no client-side navigation)
      await userPage.goto(`${baseUrl}/quotes`);
      await watch("after a link to /quotes");
    } finally {
      await userCtx.close();
    }
  }));
