/**
 * REQ-817 (demo-loop cycle dm1, m3) — the stage kept naming the customer by their phone number
 * (and a '+' cursor tag) for the whole demo after they gave a name: it asked /active only while
 * the customer's app was not connected, and a fresh answer with a new name was dropped as "the
 * same demo". Hans opens a demo for a customer who has no name yet: the stage's pill names their
 * phone, and the customer's cursor rests on its last two digits, never '+'. The customer saves a
 * name ("Maria Lopez") while connected, on the same page: the stage's pill and the customer's
 * cursor take it (the cursor rests on "ML"), with no reload of either side; after the customer's
 * next page the tab's carried demo (pm:demo-pill) holds the new name too.
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

type Page = StoryTools["page"];

/** the customer's pointer on the stage: the name it carries and its tag's words */
const customerPointer = (page: Page) =>
  page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("[data-cy='demo-pointer']"))
      .find((e) => !e.closest("[data-cy='demo-peer-pointer']"));
    if (!el) return null;
    const tag = el.querySelector("[data-cy='demo-pointer-tag']") as
      | HTMLElement
      | null;
    return {
      name: el.getAttribute("data-presenter") ?? "",
      tag: tag?.innerText.trim() ?? "",
    };
  });

/** the customer moves (two moves: a real pointer event) and then rests */
async function wiggle(userPage: Page, x: number) {
  await userPage.mouse.move(x, 320);
  await userPage.mouse.move(x + 30, 340);
}

Deno.test("REQ-817 (cycle dm1, m3): a customer who saves a name mid-demo is named by it on the stage — the pill and the cursor tag, never the phone or '+'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const userPhone = `+1512${digits()}`;
    const hansPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    // no name: the stage names the customer by their phone (REQ-355)
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
      await userPage.goto(`${baseUrl}/settings`);

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
      // the customer's app is connected: the stage mirrors it live
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Live\s*$/,
      }).waitFor({ timeout: 25_000 });

      const pill = page.locator("[data-cy='demo-pill']");
      // 1. no name yet: the phone, and a resting tag of its last digits — never '+'
      expect.eq(
        (await pill.innerText()).includes(userPhone),
        true,
        "REQ-355 the stage names an unnamed customer by their phone",
      );
      await wiggle(userPage, 300);
      await until(
        "the customer's pointer rests on the stage with a tag",
        async () => {
          const p = await customerPointer(page);
          if (p?.name === userPhone && p.tag.length > 0 && p.tag.length <= 2) {
            return true;
          }
          throw new Error(JSON.stringify(p));
        },
        15_000,
      );
      const before = await customerPointer(page);
      expect.eq(
        before?.tag,
        userPhone.slice(-2),
        "REQ-817 a phone's resting tag is its last two digits, never '+'",
      );

      // 2. the customer saves a name while connected, on the same page (no reload anywhere)
      await putMe(http, user.auth, { name: "Maria Lopez" });
      await until("the stage's pill names Maria Lopez", async () => {
        const txt = await pill.innerText();
        if (txt.includes("Maria Lopez") && !txt.includes(userPhone)) {
          return true;
        }
        throw new Error(`pill: ${JSON.stringify(txt)}`);
      }, 30_000);
      await wiggle(userPage, 500);
      await until(
        "the customer's cursor carries Maria Lopez and rests on ML",
        async () => {
          const p = await customerPointer(page);
          if (p?.name === "Maria Lopez" && p.tag === "ML") return true;
          throw new Error(JSON.stringify(p));
        },
        15_000,
      );

      // 3. the customer's next page: the tab's carried demo holds the new name
      await userPage.goto(`${baseUrl}/settings`);
      await until("the customer's carried demo holds Maria Lopez", async () => {
        const kept = await userPage.evaluate(() =>
          sessionStorage.getItem("pm:demo-pill") ?? ""
        );
        if (kept.includes('"targetName":"Maria Lopez"')) return true;
        throw new Error(kept);
      }, 20_000);
    } finally {
      await userCtx.close();
    }
  }));
