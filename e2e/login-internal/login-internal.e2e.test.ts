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

const PHONE = "+15125550980";
/** Postmark's documented blackhole: accepted and discarded — a dev box with
 *  a live Postmark key never mails a stranger. */
const EMAIL = "login-internal.story@blackhole.postmarkapp.com";
const JSON_HEADERS = { "content-type": "application/json" };

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
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ email: EMAIL, name: "Story User" }),
  });
  await me.body?.cancel();
  // A named business keeps /dashboard from bouncing a "new" user into onboarding.
  const biz = await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Story Business" }),
  });
  await biz.body?.cancel();
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
    // Unique per run — the dev KV persists, and a second run must be a NEW account again.
    const email = `new-${Date.now()}@blackhole.postmarkapp.com`;
    await page.goto("/login-internal");
    await page.fill("[data-cy=internal-email]", email);
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
    const me = await http("/api/me", {
      headers: { cookie: await sessionCookie(page) },
    });
    const who = await me.json();
    expect.eq(who.email, email, "the account was created on the address typed");
    expect.eq(who.phoneNumber, "", "with no made-up phone");
  }));

async function sessionCookie(page: StoryTools["page"]): Promise<string> {
  const cookies = await page.context().cookies();
  const c = cookies.find((k: { name: string }) => k.name === "pm_session");
  return c ? `pm_session=${c.value}` : "";
}
