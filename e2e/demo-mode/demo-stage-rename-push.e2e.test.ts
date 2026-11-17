/**
 * REQ-836 (demo-loop cycle dm2, m1) — "Stage names the customer by raw phone number until well
 * after the name is saved (REQ-817 re-check NOT_FIXED)". The stage showed an unnamed customer as
 * "+15125550400" (while /admin wrote "(512) 555-0400") and learned the name typed on /welcome's
 * first step only on its next 15 s ask — 13.1 s in the demo. Hans opens a demo for a customer who
 * has no name and sits on /welcome: the stage's pill names them by their phone as the app writes
 * it, never a '+' string. The customer types "Maria Lopez" on the name step and presses Continue
 * (no page load: the wizard's steps live in one page): the stage's pill names Maria Lopez within
 * about two seconds — the overlay sends `renamed` on the demo link and the stage asks at once.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function putMe(
  http: StoryTools["http"],
  auth: Record<string, string>,
  body: Record<string, string>,
) {
  const r = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify(body),
  });
  await r.body?.cancel();
  if (r.status >= 300) throw new Error(`PUT /api/me: ${r.status}`);
}

async function until(
  what: string,
  cond: () => boolean | Promise<boolean>,
  timeout = 15_000,
) {
  const t0 = Date.now();
  let last: unknown = null;
  while (Date.now() - t0 < timeout) {
    try {
      if (await cond()) return;
    } catch (e) {
      last = e;
    }
    await sleep(150);
  }
  throw new Error(`timed out: ${what}${last ? ` (last: ${last})` : ""}`);
}

const fmt = (e164: string) => {
  const d = e164.replace(/\D/g, "").slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

/** REQ-836 — the rename reaches the stage within this (one /active round trip, plus the poll of
 *  the wait helper); the old path took up to ACTIVE_NAME_REFRESH_MS (15 s) */
const RENAME_BUDGET_MS = 2_500;

Deno.test("REQ-836 (cycle dm2, m1): the name a customer saves on /welcome's first step names them on the stage within ~2 s; before it, their phone as the app writes it, never '+'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const userPhone = `+1512${digits()}`;
    const hansPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await putMe(http, user.auth, { language: "en" });
    const hans = await verify(http, hansPhone);
    await putMe(http, hans.auth, { language: "en", name: "Hans" });
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
      await userPage.goto(`${baseUrl}/welcome`);
      const nameInput = userPage.locator(
        "input.welcome__input[autocomplete='name']",
      );
      await nameInput.waitFor({ timeout: 20_000 });

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
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Live\s*$/,
      }).waitFor({ timeout: 25_000 });

      // 1. no name yet: the phone as /admin writes it, never the E.164 '+' string
      const pill = page.locator("[data-cy='demo-pill']");
      const before = await pill.innerText();
      expect.eq(
        before.includes(fmt(userPhone)),
        true,
        `REQ-836 the stage names an unnamed customer by their formatted phone (pill: ${
          JSON.stringify(before)
        })`,
      );
      expect.eq(
        before.includes(userPhone),
        false,
        "REQ-836 never the raw '+1…' phone",
      );

      // 2. the customer types a name on step 1 and continues — the same page, no navigation.
      //    Typed until Continue enables (the island hydrates under the demo's own boot).
      const enabled = userPage.locator(
        "[data-cy='welcome-continue']:not([disabled])",
      );
      await until("the name step takes the name", async () => {
        await nameInput.fill("Maria Lopez");
        return await enabled.count() > 0;
      }, 20_000);
      const navs: string[] = [];
      userPage.on("framenavigated", (f) => {
        if (f === userPage.mainFrame()) navs.push(f.url());
      });
      const saved = userPage.waitForResponse((r) =>
        r.url().endsWith("/api/me") && r.request().method() === "PUT"
      );
      await enabled.first().click();
      const res = await saved;
      expect.eq(res.status(), 200, "the name is saved");
      const t0 = Date.now();
      await until("the stage's pill names Maria Lopez", async () => {
        const txt = await pill.innerText();
        if (txt.includes("Maria Lopez")) return true;
        throw new Error(`pill: ${JSON.stringify(txt)}`);
      }, 20_000);
      const took = Date.now() - t0;
      expect.eq(
        navs.length,
        0,
        `the wizard moved on in the same page (navigations: ${
          JSON.stringify(navs)
        })`,
      );
      expect.eq(
        took <= RENAME_BUDGET_MS,
        true,
        `REQ-836 the saved name reached the stage in ${took} ms (budget ${RENAME_BUDGET_MS} ms)`,
      );
    } finally {
      await userCtx.close();
    }
  }));
