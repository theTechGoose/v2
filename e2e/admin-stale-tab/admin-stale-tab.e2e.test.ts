/**
 * REQ-301 — "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 1, issues M18 (a stale /admin tab printed `GET /admin/users
 * failed: 403` once another tab's Demo impersonated the customer) and m35
 * (the users table loaded once and kept "New user" / business — after the
 * customer finished onboarding).
 *
 * In a browser: two tabs of the same super-admin browser; one clicks Demo,
 * the other locks itself with a plain notice naming the customer. And a
 * fresh account's row reads "(no name yet)" until it onboards through the
 * API, then the real name and business arrive with no reload.
 *
 * Run with SUPERADMIN_BOOTSTRAP_TOKEN set when the serve is a real deploy.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

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

async function superAdmin(
  http: StoryTools["http"],
  expect: StoryTools["expect"],
) {
  const phone = `+1843${digits()}`;
  const admin = await verify(http, phone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: "en", name: "Hans" }),
  })).body?.cancel();
  const token = Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN") ?? "";
  const boot = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, token }),
  });
  expect.eq(boot.status, 200, `bootstrap super admin (${await boot.text()})`);
  return admin;
}

Deno.test("REQ-301 M18: another tab's Demo locks a stale /admin tab with a plain notice naming the customer — no raw 403, Search/Demo disabled, Back to the demo works", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const customerPhone = `+1512${digits()}`;
    const customer = await verify(http, customerPhone);
    await answerQuestions(http, customer.auth, {
      name: "Ana Torres",
      businessName: "Torres Roofing",
    });
    const admin = await superAdmin(http, expect);
    await useCookie(page.context(), baseUrl, admin.cookie);

    // tab A: /admin, the customer's row on screen
    await page.goto("/admin");
    await page.locator("[data-cy='adm-q']").fill(customerPhone.slice(2));
    await page.locator("[data-cy='adm-search']").click();
    await page.locator("[data-cy='adm-demo']").first().waitFor({
      timeout: 15_000,
    });

    // tab B, same browser: Demo → the whole browser's session becomes the customer's
    const tabB = await page.context().newPage();
    try {
      await tabB.goto(`${baseUrl}/admin`);
      await tabB.locator("[data-cy='adm-q']").fill(customerPhone.slice(2));
      await tabB.locator("[data-cy='adm-search']").click();
      await tabB.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await tabB.locator("[data-cy='adm-demo']").first().click();
      await tabB.waitForURL((u) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });

      // tab A locks itself: the notice names the customer, nothing raw
      const lock = page.locator("[data-cy='adm-lock']");
      await lock.waitFor({ timeout: 20_000 });
      const text = (await lock.innerText()).trim();
      expect(
        text.includes("Ana Torres") && /in a demo as/.test(text),
        `the notice names the customer and says why: ${text}`,
      );
      const body = await page.locator("body").innerText();
      expect(
        !/failed: 40[13]/.test(body),
        `no raw API error on the page: ${body.slice(0, 300)}`,
      );
      expect.eq(
        await page.locator("[data-cy='adm-search']").isDisabled(),
        true,
        "Search is disabled while locked",
      );
      expect.eq(
        await page.locator("[data-cy='adm-demo']").first().isDisabled(),
        true,
        "Demo is disabled while locked",
      );
      // Back to the demo lands on the stage
      await page.locator("[data-cy='adm-lock-back']").click();
      await page.waitForURL((u) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });
    } finally {
      await tabB.close();
    }
  }));

Deno.test("REQ-301 m35: /admin shows a fresh account as (no name yet); once it onboards through the API the row reads the real name and business with no reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const customerPhone = `+1512${digits()}`;
    const customer = await verify(http, customerPhone);
    const admin = await superAdmin(http, expect);
    await useCookie(page.context(), baseUrl, admin.cookie);

    await page.goto("/admin");
    await page.locator("[data-cy='adm-q']").fill(customerPhone.slice(2));
    await page.locator("[data-cy='adm-search']").click();
    const name = page.locator("[data-cy='adm-name']").first();
    await name.waitFor({ timeout: 15_000 });
    expect.eq(
      (await name.innerText()).trim(),
      "(no name yet)",
      "a placeholder is never shown as a name",
    );
    const business = page.locator("[data-cy='adm-business']").first();
    expect.eq((await business.innerText()).trim(), "—", "no business yet");
    await page.evaluate(() => {
      (globalThis as { __stale?: string }).__stale = "same-document";
    });

    // the customer finishes onboarding — the admin tab is never touched
    await answerQuestions(http, customer.auth, {
      name: "Luis Ortega",
      businessName: "Ortega Plumbing",
    });
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='adm-name']")?.textContent?.trim() ===
          "Luis Ortega" &&
        document.querySelector("[data-cy='adm-business']")?.textContent
            ?.trim() === "Ortega Plumbing",
      undefined,
      { timeout: 20_000 },
    );
    expect.eq(
      await page.evaluate(() =>
        (globalThis as { __stale?: string }).__stale ?? ""
      ),
      "same-document",
      "the row refreshed without a reload",
    );
  }));
