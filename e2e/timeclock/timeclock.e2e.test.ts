/**
 * REQ-192 — the timeclock, end to end in the browser: the owner adds a worker on /field/workers;
 * the worker signs in on /worker and clocks in, then out, on the one button; the office sees the
 * shift on /field/timesheet, adds a manual punch with a reason, and voids one with a reason.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
    body: JSON.stringify({ language: "en", name: "Clock Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name, value, url: baseUrl }]);
  return { auth, phone, session: { name, value } };
}

Deno.test("REQ-192: the worker clocks in and out on /worker; the office sees the shift on /field/timesheet, adds a manual punch and voids one", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const owner = await signIn(http, page, baseUrl);
    const cell = `843555${String(Math.floor(Math.random() * 9000) + 1000)}`;

    // 1. a worker, on /field/workers
    await page.goto("/field/workers");
    await page.locator("[data-cy='wk-name']").fill("Luis Clock");
    await page.locator("[data-cy='wk-phone']").fill(cell);
    await page.locator("[data-cy='wk-pin']").fill("1234");
    await page.locator("[data-cy='wk-add']").click();
    await page.locator("[data-cy='wk-row']").first().waitFor({
      timeout: 15_000,
    });

    // 2. the Roles folder has Timesheet
    await page.goto("/field/timesheet");
    await page.locator("[data-cy='ts-worker']").first().waitFor({
      timeout: 15_000,
    });
    await expect.see("Luis Clock");
    expect.eq(
      await page.locator("[data-cy='ts-shift']").count(),
      0,
      "no shifts yet",
    );

    // 3. the worker, on /worker — one button: Clock in → Clock out → Clock in
    await page.context().clearCookies();
    await page.goto("/worker?lang=en");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    // REQ-193 — Tasks is the tab that opens; the clock is on its own tab, its hours already open
    await page.locator("[data-cy='w-tab-tasks']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='w-tab-tasks']").getAttribute(
        "aria-selected",
      ),
      "true",
      "Tasks is selected first",
    );
    expect.eq(
      await page.locator("[data-cy='clock-button']").isVisible(),
      false,
      "the clock is out of the way on the Tasks tab",
    );
    await page.locator("[data-cy='w-tab-clock']").click();
    expect.eq(
      await page.locator("[data-cy='w-tab-clock']").getAttribute(
        "aria-selected",
      ),
      "true",
      "the clock tab is selected",
    );
    const button = page.locator("[data-cy='clock-button']");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='clock-button']")?.getAttribute(
          "data-state",
        ) === "out",
      undefined,
      { timeout: 15_000 },
    );
    expect.eq(
      (await button.textContent())?.trim(),
      "Clock in",
      "out: the button says Clock in",
    );
    await expect.see("Off the clock");
    // the week's hours are already open on the clock tab (REQ-193); the tab's dot is grey
    await expect.see("No shifts yet this week.");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='w-tab-clock-dot']")?.getAttribute(
          "data-state",
        ) === "out",
      undefined,
      { timeout: 15_000 },
    );
    await button.click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='clock-button']")?.getAttribute(
          "data-state",
        ) === "in",
      undefined,
      { timeout: 15_000 },
    );
    expect.eq(
      (await button.textContent())?.trim(),
      "Clock out",
      "in: the button says Clock out",
    );
    await expect.see("On the clock");
    await expect.see("Clocked in at");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='w-tab-clock-dot']")?.getAttribute(
          "data-state",
        ) === "in",
      undefined,
      { timeout: 15_000 },
    );
    expect.eq(
      await page.locator("[data-cy='clock-shift'][data-open='1']").count(),
      1,
      "one open shift, ticking",
    );
    await button.click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='clock-button']")?.getAttribute(
          "data-state",
        ) === "out",
      undefined,
      { timeout: 15_000 },
    );
    expect.eq((await button.textContent())?.trim(), "Clock in", "out again");
    expect.eq(
      await page.locator("[data-cy='clock-shift'][data-open='0']").count(),
      1,
      "the shift closed",
    );
    await expect.see("Last clocked out at");

    // 4. the office, signed back in: the shift on the timesheet with its times; a manual punch; a void
    await page.context().clearCookies();
    await page.context().addCookies([{ ...owner.session, url: baseUrl }]);
    await page.goto("/field/timesheet");
    await page.locator("[data-cy='ts-shift']").first().waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='ts-shift']").count(),
      1,
      "the worker's shift is on the timesheet",
    );
    expect.eq(
      await page.locator("[data-cy='ts-punch']").count(),
      2,
      "both punches, with their times, in the log",
    );
    expect.eq(
      await page.locator("[data-cy='ts-punch']").first().getAttribute(
        "data-type",
      ),
      "out",
      "newest first",
    );

    // a whole forgotten shift yesterday, 8:00–12:00, with a reason
    const yesterday = new Date(Date.now() - 86_400_000);
    const local = (h: number) => {
      const d = new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate(),
        h,
        0,
      );
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${
        p(d.getHours())
      }:${p(d.getMinutes())}`;
    };
    // yesterday is last week when today is Monday: then the pair is not in this week's view
    const inThisWeek = new Date().getDay() !== 1;
    await page.locator("[data-cy='ts-add-type']").selectOption("shift");
    await page.locator("[data-cy='ts-add-at']").fill(local(8));
    await page.locator("[data-cy='ts-add-end']").fill(local(12));
    await page.locator("[data-cy='ts-add-reason']").fill("forgot yesterday");
    await page.locator("[data-cy='ts-add-ok']").click();
    await page.waitForFunction(
      (n: number) =>
        document.querySelectorAll("[data-cy='ts-punch']").length === n,
      inThisWeek ? 4 : 2,
      { timeout: 15_000 },
    );
    if (inThisWeek) {
      expect.eq(
        await page.locator("[data-cy='ts-shift']").count(),
        2,
        "the manual pair is a second shift",
      );
      expect.eq(
        await page.locator("[data-cy='ts-punch-manual']").count(),
        2,
        "both marked manual",
      );
      // void the manual out with a reason: it stays, struck through; the in is now an anomaly
      const manualOut = page.locator("[data-cy='ts-punch'][data-type='out']")
        .last();
      await manualOut.locator("[data-cy='ts-void']").click();
      await manualOut.locator("[data-cy='ts-void-reason']").fill("wrong time");
      await manualOut.locator("[data-cy='ts-void-ok']").click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll("[data-cy='ts-punch'][data-voided='1']")
            .length === 1,
        undefined,
        { timeout: 15_000 },
      );
      await expect.see("Voided: wrong time");
      await expect.see("In without an out");
      expect.eq(
        await page.locator("[data-cy='ts-punch']").count(),
        4,
        "the voided punch stays in the log",
      );
    }
  }));
