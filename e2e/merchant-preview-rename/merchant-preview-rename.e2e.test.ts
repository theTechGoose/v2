/**
 * REQ-1044 — LOOP-007 cycle 2, issue q2-28: after renaming the business on /settings the
 * header and sidebar follow at once (REQ-737), but the Square card's merchant preview ("Who
 * your customers pay on Square's page") and the Stripe card's ("What your customers see on the
 * payment page") kept the old payee name until a reload — the cards' cached status.merchant
 * won over the live snapshot. Now both previews show the new name with no reload.
 */
import { story } from "#shots";
import {
  answerQuestions,
  JSON_HEADERS,
} from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

Deno.test("REQ-1044 q2-28: renaming the business on /settings updates the Square and Stripe merchant previews without a reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
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
    const OLD = "Reyes Tile & Bath";
    await answerQuestions(http, auth, {
      name: "Luis Reyes",
      businessName: OLD,
    });
    // the business's own Square, connected with the in-process fake (REQ-803)
    const sq = await http("/api/me/square", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ accessToken: "EAAAfake_reyes", locationId: "" }),
    });
    const sqBody = await sq.json();
    expect.eq(sqBody.connected, true, "fake Square is connected");
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
    const square = page.locator("[data-cy='square-merchant']");
    const stripe = page.locator("[data-cy='stripe-merchant']");
    await square.waitFor({ state: "attached", timeout: 15_000 });
    await stripe.waitFor({ state: "attached", timeout: 15_000 });
    // both previews have loaded their status and read the old name
    await page.waitForFunction(
      (n) =>
        ["square-merchant", "stripe-merchant"].every((cy) =>
          document.querySelector(`[data-cy='${cy}']`)?.textContent?.includes(
            n,
          ) === true
        ),
      OLD,
      { timeout: 15_000 },
    );
    await page.evaluate(() => {
      (globalThis as unknown as { __noReload: boolean }).__noReload = true;
    });

    const input = page.locator("[data-cy='settings-biz']");
    await input.waitFor({ timeout: 15_000 });
    // a fill before hydration is lost: retry until the identity PUT answers OK
    const NEW = "Reyes Tile & Bath LLC";
    let saved = false;
    for (let attempt = 0; attempt < 10 && !saved; attempt++) {
      await input.fill(NEW);
      const put = page.waitForResponse(
        (res) =>
          res.url().includes("/profile/identity") &&
          res.request().method() === "PUT",
        { timeout: 3_000 },
      ).catch(() => null);
      await input.blur();
      const res = await put;
      saved = res?.ok() === true;
    }
    expect.eq(saved, true, "the identity PUT answered OK");
    const stored = await (await http("/api/profile/identity", {
      headers: auth,
    })).json();
    expect.eq(stored.businessName, NEW, "the business name is on record");

    // the sidebar follows (REQ-737) — the page has taken the rename
    await page.waitForFunction(
      (n) =>
        document.querySelector(".sb__footer")?.textContent?.includes(n) ===
          true,
      NEW,
      { timeout: 15_000 },
    );
    // give the previews the same chance
    await page.waitForFunction(
      (n) =>
        ["square-merchant", "stripe-merchant"].every((cy) =>
          document.querySelector(`[data-cy='${cy}']`)?.textContent?.includes(
            n,
          ) === true
        ),
      NEW,
      { timeout: 5_000 },
    ).catch(() => {});
    const [sqText, stText, noReload] = await page.evaluate(() => [
      document.querySelector("[data-cy='square-merchant']")?.textContent ?? "",
      document.querySelector("[data-cy='stripe-merchant']")?.textContent ?? "",
      (globalThis as unknown as { __noReload?: boolean }).__noReload === true,
    ]);
    expect.eq(noReload, true, "no reload happened");
    const stale = [
      String(sqText).includes(NEW)
        ? null
        : `the Square merchant preview reads the new name "${NEW}" (got "${sqText}")`,
      String(stText).includes(NEW)
        ? null
        : `the Stripe merchant preview reads the new name "${NEW}" (got "${stText}")`,
    ].filter(Boolean);
    expect(stale.length === 0, stale.join(" | "));
  }));
