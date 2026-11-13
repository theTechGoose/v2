/**
 * REQ-391 — demo-loop cycle 2, issues M4 and m21, end to end in two real browsers.
 *
 *   M4: the customer changes page IN the app (the app's own navigation, `location.href`, as the
 *       assistant does on a job's first line): the stage pill says "Loading their next page…"
 *       while their next page loads — never "Live" over the old page for the whole grace, never
 *       "Waiting" — and "Live" once the new page is in the frame. With the debug flag (REQ-650) the stats chip
 *       measures how late the frames arrive (lag, and the wire alone).
 *   m21: the customer leaves the app (the demo agent's "closed the tab": the tab to about:blank):
 *       the stage says "Waiting for Ana Torres's app…" within ~2 s, not after the 5 s grace, and
 *       the notice is a banner across the frame's top edge — never a card over the middle of their
 *       page. Their app back, the stage is Live again and the banner gone.
 */
import { story, type StoryTools } from "#shots";
import { pillUp } from "../_shared/demo-pill.ts";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

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
    await sleep(50);
  }
  throw new Error(`timed out: ${what}`);
}
/** `until`, but a timeout is an answer (false), not a failure */
const within = (cond: () => boolean | Promise<boolean>, timeout: number) =>
  until("", cond, timeout).then(() => true, () => false);

/** a customer (Ana Torres) and a super admin (Hans), signed up fresh */
async function people(http: StoryTools["http"]) {
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: "en", name: "Ana Torres" }),
  })).body?.cancel();
  // past onboarding (REQ-091), so the app's pages are the customer's to move between
  await answerQuestions(http, user.auth, {
    name: "Ana Torres",
    businessName: "Torres Plumbing",
  });
  const admin = await verify(http, adminPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: "en", name: "Hans" }),
  })).body?.cancel();
  const boot = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: adminPhone }),
  });
  await boot.body?.cancel();
  if (boot.status !== 200) throw new Error(`bootstrap: ${boot.status}`);
  return { user, admin, userPhone, adminPhone };
}

// deno-lint-ignore no-explicit-any
type Page = any;

/** on /admin: find the customer and click Demo; the page lands on the stage */
async function openDemo(pg: Page, baseUrl: string, userPhone: string) {
  await pg.goto(`${baseUrl}/admin`);
  await pg.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
  await pg.locator("[data-cy='adm-search']").click();
  await pg.locator("[data-cy='adm-demo']").first().waitFor({ timeout: 15_000 });
  await pg.locator("[data-cy='adm-demo']").first().click();
  await pg.waitForURL((u: URL) => u.pathname === "/demo/stage", {
    timeout: 20_000,
  });
  await pg.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
}

const statusOf = (pg: Page) =>
  pg.locator("[data-cy='demo-status']").innerText().then((s: string) =>
    s.trim()
  );
const framePath = (pg: Page) =>
  pg.locator("[data-cy='demo-frame']").getAttribute("data-path");
/** the stage is Live on `path`; a timeout says what it showed instead */
const liveOn = async (pg: Page, path: string, timeout = 25_000) => {
  let seen = "";
  await until(`the stage is Live on ${path}`, async () => {
    seen = `${await statusOf(pg)} on ${await framePath(pg)}`;
    return seen === `Live on ${path}`;
  }, timeout).catch((e) => {
    throw new Error(`${(e as Error).message} (it showed: ${seen})`);
  });
};

/** start recording every text the staff pill's status shows (every 25 ms) */
const recordStatus = (pg: Page) =>
  pg.evaluate(() => {
    const w = globalThis as unknown as {
      __pmSeen: string[];
      __pmTimer?: ReturnType<typeof setInterval>;
    };
    clearInterval(w.__pmTimer);
    w.__pmSeen = [];
    w.__pmTimer = setInterval(() => {
      const s = document.querySelector("[data-cy='demo-status']")
        ?.textContent ?? "";
      if (w.__pmSeen[w.__pmSeen.length - 1] !== s) w.__pmSeen.push(s);
    }, 25);
  });
const recorded = (pg: Page) =>
  pg.evaluate(() =>
    (globalThis as unknown as { __pmSeen: string[] }).__pmSeen
  ) as Promise<string[]>;

Deno.test("REQ-391 (demo-loop cycle 2, M4 + m21): an in-app page change says 'Loading their next page…' — never Live over the old page, never Waiting — and the dev chip measures the lag; the customer leaving the app is 'Waiting for …' within ~2 s, under a banner across the frame's top", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const who = await people(http);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    /** what REQ-391 is about, each found wrong: said together at the end */
    const problems: string[] = [];
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, who.user.cookie);
      await tab.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, who.admin.cookie);
      // REQ-650 — the stage's counters show only behind the debug flag (no longer by hostname)
      await page.addInitScript(() =>
        localStorage.setItem("pm_demo_debug", "1")
      );
      await openDemo(page, baseUrl, who.userPhone);
      await tab.reload();
      await pillUp(tab);
      await liveOn(page, "/dashboard");

      // M4 — a page change made by the app itself
      await recordStatus(page);
      await tab.evaluate(() =>
        setTimeout(() => {
          location.href = "/customers";
        }, 0)
      );
      await tab.waitForURL(/\/customers/, { timeout: 15_000 });
      await pillUp(tab);
      await liveOn(page, "/customers");
      const during = await recorded(page);
      if (!during.includes("Loading their next page…")) {
        problems.push(
          `M4: the pill never said their next page was loading — it stayed ${
            JSON.stringify(during)
          }`,
        );
      }
      if (during.some((s) => /waiting/i.test(s))) {
        problems.push(
          `M4: an in-app page change showed waiting (${
            JSON.stringify(during)
          })`,
        );
      }
      const chip = "[data-cy='demo-mirror-stats']";
      if (
        !(await within(
          async () =>
            /\blag \d/.test(await page.locator(chip).innerText()) &&
            /\bnet \d/.test(await page.locator(chip).innerText()),
          5_000,
        ))
      ) {
        problems.push(
          `M4: the dev chip measures no lag ("${await page.locator(chip)
            .innerText().catch(() => "")}")`,
        );
      }

      // m21 — the customer leaves the app: the tab to about:blank, as the demo agent "closed" it
      await recordStatus(page);
      const t0 = Date.now();
      await tab.goto("about:blank");
      await until(
        "the stage says it is waiting for the customer's app",
        async () => /Waiting for Ana Torres's app/.test(await statusOf(page)),
        12_000,
      );
      const took = Date.now() - t0;
      if (took > 2_500) {
        problems.push(
          `m21: the stage noticed after ${took} ms (wanted ≤ 2 500 ms; seen ${
            JSON.stringify(await recorded(page))
          })`,
        );
      }
      await page.locator("[data-cy='demo-waiting']").waitFor({
        timeout: 5_000,
      });
      const geo = await page.evaluate(() => {
        const b = document.querySelector("[data-cy='demo-waiting']")
          ?.getBoundingClientRect();
        const f = document.querySelector("[data-cy='demo-frame']")
          ?.getBoundingClientRect();
        return b && f
          ? {
            top: b.top - f.top,
            left: b.left - f.left,
            width: b.width - f.width,
            height: b.height,
            frameHeight: f.height,
          }
          : null;
      });
      if (!geo) {
        problems.push("m21: no waiting notice or no frame on the stage");
      } else if (
        Math.abs(geo.top) > 2 || Math.abs(geo.left) > 2 ||
        Math.abs(geo.width) > 2 || geo.height > geo.frameHeight * 0.2
      ) {
        problems.push(
          `m21: the waiting notice is not a banner across the frame's top edge (${
            JSON.stringify(geo)
          })`,
        );
      }

      // their app back: Live again, the banner gone
      await tab.goto(`${baseUrl}/dashboard`);
      await pillUp(tab);
      await liveOn(page, "/dashboard");
      await page.locator("[data-cy='demo-waiting']").waitFor({
        state: "hidden",
        timeout: 5_000,
      });

      expect(
        problems.length === 0,
        `REQ-391: ${problems.join(" | ")}`,
      );
      expect.eq(await statusOf(page), "Live", "and it is Live");
    } finally {
      await userCtx.close();
    }
  }));
