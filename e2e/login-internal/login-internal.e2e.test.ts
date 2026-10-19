/**
 * REQ-050 — "i want to make a new login-internal route that will allow me to
 * log in with email."
 *
 * The pages: front-end/routes/login-internal.tsx and verify-internal.tsx.
 * The stories the judge reviews: the page asks for an email, an account with
 * that email on file logs in with the emailed code (the dev master code
 * 000000 — the gate runs off Deno Deploy), and an email no account has yet
 * just creates one and lands in onboarding.
 * The account is seeded through the API the way every account is made: the
 * phone flow, then the email goes on the record through PUT /me.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const PHONE = "+15125550980";
/** Postmark's documented blackhole: accepted and discarded — a dev box with
 *  a live Postmark key never mails a stranger. */
const EMAIL = "login-internal.story@blackhole.postmarkapp.com";
/** The address Raphael named — created fresh by the third story on every run. */
const RAFAC = "rafac@monsterrg.com";
const JSON_HEADERS = { "content-type": "application/json" };

/** Hard-delete whatever account carries `email` (sign in with the dev master
 *  code — which finds or creates it — then GET /me/wipe on that session). */
async function wipeAccountOn(http: StoryTools["http"], email: string) {
  const r = await http("/api/auth/verify-email-otp", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, code: "000000" }),
  });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  await r.body?.cancel();
  if (!cookie) {
    throw new Error(`wipe: could not sign in as ${email} (${r.status})`);
  }
  const w = await http("/api/me/wipe", { headers: { cookie } });
  if (!w.ok) throw new Error(`wipe: GET /me/wipe → ${w.status}`);
  await w.body?.cancel();
}

async function seedAccount(http: StoryTools["http"]) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: PHONE, code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    // The dev KV persists across runs — an earlier run may have closed it.
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) {
    throw new Error(`seed: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  // REQ-091: a code lands on the dashboard only once every onboarding question is answered
  await answerQuestions(http, auth, { name: "Story User", email: EMAIL, businessName: "Story Business" });
  const out = await http("/api/auth/logout", { method: "POST", headers: auth });
  await out.body?.cancel();
  return body.userId as string;
}

Deno.test("REQ-050: the login-internal page asks for an email, not a phone", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/login-internal");
    const email = page.locator("[data-cy=internal-email]");
    await email.waitFor({ state: "visible" });
    expect.eq(
      await email.getAttribute("type"),
      "email",
      "the one input is an email input",
    );
    expect.eq(
      await page.locator("input[type=tel]").count(),
      0,
      "no phone input on this page",
    );
    expect(
      await page.locator("[data-cy=internal-submit]").isVisible(),
      "a submit button is offered",
    );
  }));

Deno.test("REQ-050: an account with that email on file logs in with the emailed code", (t) =>
  story(t, async ({ page, expect, http }) => {
    const userId = await seedAccount(http);

    await page.goto("/login-internal");
    await page.fill("[data-cy=internal-email]", EMAIL);
    await page.click("[data-cy=internal-submit]");
    await page.waitForURL(/\/verify-internal\?/);
    expect(
      page.url().includes(`email=${encodeURIComponent(EMAIL)}`),
      "the verify page carries the address",
    );
    await expect.see(EMAIL);

    const slots = page.locator("input[inputmode=numeric]");
    await slots.first().waitFor({ state: "visible" });
    expect.eq(await slots.count(), 6, "six code boxes");
    for (let i = 0; i < 6; i++) await slots.nth(i).fill("0");

    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
    expect(
      page.url().includes("/dashboard"),
      "signed in — landed on the dashboard",
    );
    // The frame the reviewer sees: the dashboard, still signed in on reload.
    await page.goto("/dashboard");
    expect(
      new URL(page.url()).pathname === "/dashboard",
      "stays signed in on the dashboard",
    );
    const me = await http("/api/me", {
      headers: { cookie: await sessionCookie(page) },
    });
    const who = await me.json();
    expect.eq(
      who.id,
      userId,
      "the session belongs to the account that carries the email",
    );
  }));

Deno.test("REQ-050: an email no account has yet just creates the account and signs in", (t) =>
  story(t, async ({ page, expect, http }) => {
    // Raphael's words: "it needs to just create an account. rafac@monsterrg.com".
    // The dev KV persists across runs, so any account already on the address
    // is hard-deleted first (its own session, GET /me/wipe) — the page then
    // creates it anew, every run.
    await wipeAccountOn(http, RAFAC);

    await page.goto("/login-internal");
    await page.fill("[data-cy=internal-email]", RAFAC);
    await page.click("[data-cy=internal-submit]");
    await page.waitForURL(/\/verify-internal\?/);
    const slots = page.locator("input[inputmode=numeric]");
    await slots.first().waitFor({ state: "visible" });
    for (let i = 0; i < 6; i++) await slots.nth(i).fill("0");

    await page.waitForURL(/\/welcome/, { timeout: 20_000 });
    expect(
      page.url().includes("/welcome"),
      "a brand-new account lands in onboarding",
    );
    // The frame the reviewer sees: onboarding, still signed in on reload (a
    // signed-out visitor would be bounced off /welcome).
    await page.goto("/welcome");
    expect(
      new URL(page.url()).pathname === "/welcome",
      "stays signed in, in onboarding",
    );
    const me = await http("/api/me", {
      headers: { cookie: await sessionCookie(page) },
    });
    const who = await me.json();
    expect.eq(
      who.email,
      RAFAC,
      "the account was created on rafac@monsterrg.com",
    );
    expect.eq(who.phoneNumber, "", "with no made-up phone");
  }));

async function sessionCookie(page: StoryTools["page"]): Promise<string> {
  const cookies = await page.context().cookies();
  const c = cookies.find((k: { name: string }) => k.name === "pm_session");
  return c ? `pm_session=${c.value}` : "";
}

/** REQ-063 — hans@documonster.com is always a super-admin, by address: signed in by email, the
 *  admin routes answer; anyone else on the same flow is refused. */
const HANS = "hans@documonster.com";

Deno.test("REQ-063: hans@documonster.com signs in by email and is a super-admin — the admin routes answer; a stranger is refused", (t) =>
  story(t, async ({ page, expect, http }) => {
    await page.goto("/login-internal");
    await page.fill("[data-cy=internal-email]", HANS);
    await page.click("[data-cy=internal-submit]");
    await page.waitForURL(/\/verify-internal\?/);
    const slots = page.locator("input[inputmode=numeric]");
    await slots.first().waitFor({ state: "visible" });
    for (let i = 0; i < 6; i++) await slots.nth(i).fill("0");
    await page.waitForURL(/\/(welcome|home|settings|dashboard)/, { timeout: 20_000 });
    const cookie = await sessionCookie(page);
    // English on the account: the settings page reads the user's language first (the site defaults to Spanish, REQ-002)
    const lang = await http("/api/me", { method: "PUT", headers: { ...JSON_HEADERS, cookie }, body: JSON.stringify({ language: "en" }) });
    await lang.body?.cancel();
    const who = await (await http("/api/me", { headers: { cookie } })).json();
    expect.eq(who.email, HANS, "signed in on the address");
    expect(who.superAdmin === true, `whoami says super-admin (${JSON.stringify(who)})`);
    const admin = await http("/api/admin/users?q=", { headers: { cookie } });
    expect.eq(admin.status, 200, "the admin search answers hans");
    await admin.body?.cancel();
    // the frame the reviewer sees: settings, signed in as hans
    await page.goto("/settings?lang=en");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Current plan");
    // a stranger on the same flow has no admin
    const s = await http("/api/auth/verify-email-otp", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email: `stranger-${Date.now()}@blackhole.postmarkapp.com`, code: "000000" }) });
    const strangerCookie = (s.headers.get("set-cookie") ?? "").split(";")[0];
    await s.body?.cancel();
    const refused = await http("/api/admin/users?q=", { headers: { cookie: strangerCookie } });
    expect.eq(refused.status, 403, "a stranger is refused");
    await refused.body?.cancel();
  }));
