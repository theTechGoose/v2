/**
 * REQ-1038 (LOOP-007 cycle 2, q2-22) — amends REQ-944 / REQ-192. The business is in
 * America/Chicago; the browser runs in UTC (an owner or bookkeeper away from the shop, or the
 * QA tester). A worker clocks in on /worker: "Clocked in at …" must be the punch's Chicago wall
 * time, and the owner's /field/timesheet punch log must show the same Chicago day and time —
 * not the device's UTC clock (the bug read 7:56 AM for a 01:56 AM Central punch).
 */
import { story, type StoryTools } from "#shots";

const TZ = "America/Chicago";
const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const norm = (s: string | null) => (s ?? "").replace(/[\s  ]+/g, " ").trim();

async function owner(http: StoryTools["http"]) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Clock Zone Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  return { auth, session: { name, value } };
}

Deno.test("REQ-1038 (q2-22): with the browser in UTC and the business in Chicago, the worker's 'Clocked in at' and the owner's timesheet log show the punch's Chicago wall time", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const o = await owner(http);
    const send = async (method: string, p: string, b: unknown) => {
      const r = await http(p, { method, headers: o.auth, body: JSON.stringify(b) });
      return { status: r.status, body: await r.json() };
    };
    const ident = await send("PUT", "/api/profile/identity", {
      businessName: "Zone Clock Lawn",
      timezone: TZ,
    });
    expect.eq(ident.body?.timezone, TZ, "the business zone is Chicago");
    const cell = `843${digits()}`;
    const worker = await send("POST", "/api/field/workers", {
      name: "Rosa Clock",
      phoneNumber: cell,
      pin: "1234",
      language: "en",
    });
    expect(worker.status < 300, `worker created (${worker.status} ${JSON.stringify(worker.body)})`);

    // the device runs in UTC, not the business zone
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "UTC" });
    const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({ name: "pm_lang", value: "en", domain, path: "/" })),
    );

    // the worker clocks in
    await page.goto("/worker?lang=en");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.locator("[data-cy='w-tab-clock']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
      "UTC",
      "the browser runs in UTC",
    );
    await page.locator("[data-cy='w-tab-clock']").click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='clock-button']")?.getAttribute("data-state") === "out",
      undefined,
      { timeout: 15_000 },
    );
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/timeclock\/worker\/punch$/.test(new URL(r.url()).pathname),
        { timeout: 15_000 },
      ),
      page.locator("[data-cy='clock-button']").click(),
    ]);
    expect.eq(res.status(), 201, "the punch is recorded");
    const at: string = (await res.json()).punch.at;
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='clock-button']")?.getAttribute("data-state") === "in",
      undefined,
      { timeout: 15_000 },
    );

    // the expected strings, from the browser's own ICU, in Chicago and (the bug) in UTC
    const want = await page.evaluate(({ at, tz }) => {
      const t = (zone: string) =>
        new Date(at).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: zone,
        });
      const d = (zone: string) =>
        new Date(at).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: zone,
        });
      return {
        bizTime: t(tz),
        utcTime: t("UTC"),
        bizWhen: `${d(tz)} ${t(tz)}`,
        utcWhen: `${d("UTC")} ${t("UTC")}`,
      };
    }, { at, tz: TZ });
    const bizTime = norm(want.bizTime);
    const bizWhen = norm(want.bizWhen);

    // both surfaces are checked before failing, so the red names every wrong one
    const misses: string[] = [];
    const since = norm(await page.locator("[data-cy='clock-since']").textContent());
    if (!since.includes(`Clocked in at ${bizTime}`)) {
      misses.push(
        `the worker's clock reads "Clocked in at ${bizTime}" (Chicago, punch ${at}); got "${since}" (UTC would be ${norm(want.utcTime)})`,
      );
    }

    // the owner's timesheet, same UTC browser
    await page.context().clearCookies();
    await page.context().addCookies([{ ...o.session, url: baseUrl }]);
    await page.goto("/field/timesheet");
    await page.locator("[data-cy='ts-punch']").first().waitFor({ timeout: 15_000 });
    const row = norm(
      await page.locator("[data-cy='ts-punch']").first().locator("td").nth(2).textContent(),
    );
    if (row !== bizWhen) {
      misses.push(
        `the timesheet log shows the punch at Chicago's "${bizWhen}"; got "${row}" (UTC would be "${norm(want.utcWhen)}")`,
      );
    }
    expect(misses.length === 0, misses.join(" | "));
  }));
