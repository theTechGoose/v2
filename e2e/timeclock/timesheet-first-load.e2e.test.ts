/**
 * REQ-1000 — LOOP-007 cycle 1, issue q1-86 "Timesheet first load shows 'No punches this week'
 * while a worker is clocked in". The worker clocks in (through their own pm_worker session, as
 * /worker does); the office opens /field/timesheet while GET /api/timeclock/punches is slow. The
 * log panel must never say "No punches this week." (nor a count of 0) before the punch row
 * appears — that is a false empty state, the page simply hadn't loaded. A week that really has no
 * punches (the week before) still says so once loaded.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const NO_PUNCHES = "No punches this week.";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
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
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "First Load Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name, value, url: baseUrl }]);
  return auth;
}

Deno.test("REQ-1000 (LOOP-007 q1-86): with a worker clocked in and a slow punches fetch, /field/timesheet never shows 'No punches this week' before the punch row", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const cell = `843555${String(Math.floor(Math.random() * 9000) + 1000)}`;

    // a worker, who clocks in through their own session (the /worker button's call)
    const w = await http("/api/field/workers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Luis First", phoneNumber: cell, pin: "1234" }),
    });
    expect(w.status === 201 || w.status === 200, `worker created (${w.status})`);
    await w.body?.cancel();
    const li = await http("/api/field/worker/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: cell, pin: "1234" }),
    });
    await li.body?.cancel();
    const workerCookie = (li.headers.get("set-cookie") ?? "").split(";")[0];
    expect(!!workerCookie, `the worker has a session (${li.status})`);
    const punch = await http("/api/timeclock/worker/punch", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: workerCookie },
      body: JSON.stringify({}),
    });
    expect(
      punch.status === 201 || punch.status === 200,
      `the worker clocked in (${punch.status})`,
    );
    await punch.body?.cancel();

    // every state the log panel ever shows, from the first parsed byte on
    await page.addInitScript((noPunches: string) => {
      const seen: string[] = [];
      (globalThis as unknown as { __tsLogSeen: string[] }).__tsLogSeen = seen;
      const look = () => {
        const p = document.querySelector("[data-cy='ts-log-panel']");
        if (!p) return;
        const count = p.querySelector(".count")?.textContent?.trim() ?? "";
        const rows = p.querySelectorAll("[data-cy='ts-punch']").length;
        const empty = (p.textContent ?? "").includes(noPunches);
        const s = `count=${count} rows=${rows} empty=${empty}`;
        if (seen[seen.length - 1] !== s) seen.push(s);
      };
      new MutationObserver(look).observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      document.addEventListener("DOMContentLoaded", look);
    }, NO_PUNCHES);

    // the punches fetch is slow (2 s), as on a busy dev stack
    await page.route("**/api/timeclock/punches*", async (route) => {
      await new Promise((r) => setTimeout(r, 2_000));
      await route.continue();
    });

    await page.goto("/field/timesheet");
    await page.locator("[data-cy='ts-punch']").first().waitFor({
      timeout: 20_000,
    });
    const seen = await page.evaluate(() =>
      (globalThis as unknown as { __tsLogSeen: string[] }).__tsLogSeen
    );
    const firstRow = seen.findIndex((s) => !s.includes("rows=0"));
    const before = seen.slice(0, firstRow < 0 ? seen.length : firstRow);
    expect(
      before.every((s) => !s.includes("empty=true")),
      `the log panel said "${NO_PUNCHES}" before the punch loaded: ${
        JSON.stringify(seen)
      }`,
    );
    expect(
      before.every((s) => !s.includes("count=0")),
      `the log count read 0 before the punch loaded: ${JSON.stringify(seen)}`,
    );
    expect.eq(
      await page.locator("[data-cy='ts-punch']").count(),
      1,
      "the worker's clock-in is in the log",
    );

    // a week that really has no punches still says so, once loaded
    await page.unroute("**/api/timeclock/punches*");
    await page.locator("[data-cy='ts-prev']").click();
    await page.waitForFunction(
      (noPunches: string) =>
        (document.querySelector("[data-cy='ts-log-panel']")?.textContent ?? "")
          .includes(noPunches),
      NO_PUNCHES,
      { timeout: 15_000 },
    );
  }));
