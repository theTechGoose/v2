/**
 * REQ-929 — "in settings add an inactivity timer, this way it logs the user out if they are not
 * using it." On the real shell with Playwright's fake clock: the owner picks 15 minutes on
 * Settings (saved through PUT /me); with no reload, after 14 idle minutes the banner warns,
 * "Stay signed in" resets the timer, and 15 idle minutes later the tab is on /login?idle=1 with
 * the notice — and the session is gone on the server.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", { method: "PUT", headers: auth, body: JSON.stringify({ language: "en" }) });
  await me.body?.cancel();
  await answerQuestions(http, auth, { name: "Idle Story", businessName: "Idle Story LLC" });
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

const SELECT = "[data-cy='settings-idle-logout']";
const WARN = "[data-cy='idle-warning']";

Deno.test("REQ-929: 15 minutes picked on Settings — the warning at 14, Stay signed in resets it, signed out to /login?idle=1 at 15 and the session is dead", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await page.clock.install();
    await page.goto("/settings");
    await page.locator(SELECT).waitFor({ timeout: 20_000 });
    expect.eq(await page.locator(SELECT).inputValue(), "0", "unset reads Never");

    // the pick is saved through PUT /me (wait on the response, never a toast)
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/me") && r.request().method() === "PUT");
    await page.locator(SELECT).selectOption("15");
    expect.eq((await saved).status(), 200, "PUT /me saves the pick");
    const me = await (await http("/api/me", { headers: auth })).json();
    expect.eq(me.idleLogoutMinutes, 15, "stored on the person's record");

    // no reload: the timer runs on the new setting at once
    expect.eq(await page.locator(WARN).count(), 0, "no banner while active");
    await page.clock.fastForward("14:01");
    await page.locator(WARN).waitFor({ state: "visible", timeout: 10_000 });
    const text = (await page.locator(WARN).textContent()) ?? "";
    expect(/signed out in 0:\d\d/.test(text), `the warning counts down: "${text}"`);

    await page.locator("[data-cy='idle-stay']").click();
    await page.locator(WARN).waitFor({ state: "hidden", timeout: 10_000 });
    expect(page.url().includes("/settings"), `still on Settings: ${page.url()}`);

    // 15 idle minutes after the reset: signed out
    await page.clock.fastForward("15:01");
    await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("idle") === "1", { timeout: 20_000 });
    await page.locator("[data-cy='login-idle-notice']").waitFor({ timeout: 15_000 });
    const after = await http("/api/me", { headers: auth });
    expect.eq(after.status, 401, "the server session is gone");
    await after.body?.cancel();
  }));
