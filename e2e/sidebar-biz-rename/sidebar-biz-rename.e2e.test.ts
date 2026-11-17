/**
 * REQ-737 — demo-loop cycle 5 (run r37f88707), issue p12: after renaming the business in
 * Settings, the sidebar footer on the same page kept the old business name until the next
 * navigation. Now the rename shows in the sidebar at once, with no reload.
 */
import { story } from "#shots";
import {
  answerQuestions,
  JSON_HEADERS,
} from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

Deno.test("REQ-737 p12: renaming the business in Settings updates the sidebar footer without a reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
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
      body: JSON.stringify({ language: "en" }),
    })).body?.cancel();
    await answerQuestions(http, auth, {
      name: "Carl Jensen",
      businessName: "Old Name Electric",
    });
    const [name, value] = cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].flatMap((domain) => [
        { name, value, domain, path: "/" },
        { name: "pm_lang", value: "en", domain, path: "/" },
      ]),
    );

    await page.goto("/settings");
    const footer = page.locator(".sb__footer");
    await page.waitForFunction(
      () =>
        document.querySelector(".sb__footer")?.textContent?.includes(
          "Old Name Electric",
        ) === true,
      undefined,
      { timeout: 15_000 },
    );
    await page.evaluate(() => {
      (globalThis as unknown as { __noReload: boolean }).__noReload = true;
    });
    const input = page.locator("[data-cy='settings-biz']");
    await input.waitFor({ timeout: 15_000 });
    // a fill before hydration is lost: retry until the save lands on the server
    const NEW = "Bright New Electric";
    let saved = "";
    for (let attempt = 0; attempt < 10 && saved !== NEW; attempt++) {
      await input.fill(NEW);
      await input.blur();
      for (let i = 0; i < 10 && saved !== NEW; i++) {
        await page.waitForTimeout(300);
        saved = (await (await http("/api/profile/identity", { headers: auth }))
          .json()).businessName;
      }
    }
    expect.eq(saved, NEW, "the business name is on record");
    await page.waitForFunction(
      (n) =>
        document.querySelector(".sb__footer")?.textContent?.includes(n) ===
          true,
      NEW,
      { timeout: 15_000 },
    );
    expect(
      !((await footer.textContent()) ?? "").includes("Old Name Electric"),
      "the old business name is gone from the sidebar",
    );
    expect.eq(
      await page.evaluate(() =>
        (globalThis as unknown as { __noReload?: boolean }).__noReload === true
      ),
      true,
      "the sidebar followed the rename without a reload",
    );
  }));
