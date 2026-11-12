/**
 * REQ-376 — "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 2, issues m20 (a second staff tab opened on /admin while a
 * demo ran was silently redirected to the customer's /dashboard) and
 * nc-second-demo (a second demo could not be started from the same browser).
 *
 * In a browser: a super admin starts a demo from /admin (the browser's session
 * becomes the customer's); a NEW tab on /admin shows the interstitial naming
 * the customer — not the customer's dashboard; "Return to your account" hands
 * the account back and lands on the admin console, where Demo is reachable
 * again.
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

Deno.test("REQ-376 m20 + nc-second-demo: a second /admin tab during a demo shows 'You are guiding {name} in this browser' — not the customer's /dashboard — and Return to your account brings the console (and Demo) back", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const customerPhone = `+1512${digits()}`;
    const customer = await verify(http, customerPhone);
    await answerQuestions(http, customer.auth, {
      name: "Carla Mendez",
      businessName: "Mendez Painting",
    });
    const admin = await superAdmin(http, expect);
    await useCookie(page.context(), baseUrl, admin.cookie);

    // tab A: /admin → Demo → the stage (the whole browser now acts as the customer)
    await page.goto("/admin");
    await page.locator("[data-cy='adm-q']").fill(customerPhone.slice(2));
    await page.locator("[data-cy='adm-search']").click();
    await page.locator("[data-cy='adm-demo']").first().waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='adm-demo']").first().click();
    await page.waitForURL((u) => u.pathname === "/demo/stage", {
      timeout: 20_000,
    });

    // tab B, same browser: /admin explains instead of becoming the customer's dashboard
    const tabB = await page.context().newPage();
    try {
      await tabB.goto(`${baseUrl}/admin`);
      expect.eq(
        new URL(tabB.url()).pathname,
        "/admin",
        "the second tab stays on /admin (no silent redirect to /dashboard)",
      );
      const gate = tabB.locator("[data-cy='admin-gate']");
      await gate.waitFor({ timeout: 15_000 });
      const text = (await gate.innerText()).trim();
      expect(
        text.includes("You are guiding Carla Mendez in this browser"),
        `the interstitial names the customer: ${text}`,
      );
      expect(
        /start another demo/i.test(text),
        `it says how to start another demo: ${text}`,
      );
      expect.eq(
        await tabB.locator("[data-cy='admin-gate-back']").getAttribute("href"),
        "/demo/stage",
        "Back to the demo goes to the stage",
      );

      // Return to your account → the console, Demo reachable again
      await tabB.locator("[data-cy='admin-gate-return']").click();
      await tabB.locator("[data-cy='adm-q']").waitFor({ timeout: 20_000 });
      expect.eq(new URL(tabB.url()).pathname, "/admin", "back on the console");
      await tabB.locator("[data-cy='adm-q']").fill(customerPhone.slice(2));
      await tabB.locator("[data-cy='adm-search']").click();
      await tabB.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      expect.eq(
        await tabB.locator("[data-cy='adm-demo']").first().isDisabled(),
        false,
        "Demo can be started again",
      );
    } finally {
      await tabB.close();
    }
  }));
