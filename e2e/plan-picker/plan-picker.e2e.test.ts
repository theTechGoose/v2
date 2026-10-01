/**
 * REQ-054 — "we want to use the link builder so in onboarding a user can pick their plan. they
 * can pick free but later can upgrade to paid in the settings panel."
 *
 * The pages: the /welcome wizard's plan step (front-end/islands/WelcomeWizard.tsx) and the Plan
 * card on /settings (front-end/islands/SettingsPage.tsx). The gate runs on the fakes: the CRM
 * behind the pay link is the in-process fake (PPWK_PAYMENTS_URL unset), and its one remote
 * control, POST /api/me/plan/fake-paid, is what settles the due the way a card on the real pay
 * page would.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** A fresh account (a new phone each run) signed in on the page's browser context. */
async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string, profile: Record<string, string>) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ phoneNumber: phone, code: "000000" }) });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: body.recoveryToken }) });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  // English on the account: the wizard reads the user's language first (the site defaults to Spanish, REQ-002)
  const me = await http("/api/me", { method: "PUT", headers: auth, body: JSON.stringify({ language: "en", ...profile }) });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([{ name, value, domain: host, path: "/" }, { name: "pm_lang", value: "en", domain: host, path: "/" }]);
  return auth;
}

Deno.test("REQ-054: in onboarding the person picks a paid plan, pays on the link builder's page, and the plan is active", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl, { name: "Plan Story", email: `plan-${digits()}@blackhole.postmarkapp.com` });
    await page.goto("/welcome");
    // the wizard resumes at the first incomplete step: the business name — skip it; the email is
    // on file, so its step is prefilled — continue; then the plan
    await page.locator("[data-cy='welcome-skip']").waitFor({ timeout: 60_000 });
    await page.locator("[data-cy='welcome-skip']").click();
    await expect.see("best email");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("Pick your plan");
    await expect.see("Monster Free");
    await expect.see("$99");
    await expect.see("$199");
    await page.locator("[data-cy='plan-pick-monster']").click();
    // the paid pick hands the person the CRM's pay page — the link builder's link
    await page.locator("[data-cy='plan-pay-link']").waitFor({ timeout: 60_000 });
    const href = await page.locator("[data-cy='plan-pay-link']").getAttribute("href");
    expect((href ?? "").includes("/ui/payments/charge?customer="), `the pay link is the CRM's charge page (${href})`);
    await expect.see("Waiting for the payment");
    // nothing paid yet: checking keeps it pending
    await page.locator("[data-cy='plan-check-paid']").click();
    await expect.see("not landed yet");
    // the person pays on the pay page (the fake's remote control stands in for the card)
    const paid = await http("/api/me/plan/fake-paid", { method: "POST", headers: auth });
    expect(paid.status === 200, `fake-paid answers 200 (got ${paid.status})`);
    await paid.body?.cancel();
    await page.locator("[data-cy='plan-check-paid']").click();
    await expect.see("Monster is active");
    const plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "monster" && plan.status === "active", `the record says monster · active (${JSON.stringify(plan)})`);
    // and the wizard moves on
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("Which state");
  }));

Deno.test("REQ-054: free in onboarding, then upgraded to a paid plan from the settings panel", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl, { name: "Free Story", email: `free-${digits()}@blackhole.postmarkapp.com` });
    await page.goto("/welcome");
    await page.locator("[data-cy='welcome-skip']").waitFor({ timeout: 60_000 });
    await page.locator("[data-cy='welcome-skip']").click();
    await expect.see("best email");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("Pick your plan");
    await page.locator("[data-cy='plan-pick-free']").click();
    await expect.see("Which state");
    let plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "free" && plan.status === "free", `free is stored as free (${JSON.stringify(plan)})`);

    // later, the settings panel
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster Free");
    await page.locator("[data-cy='plan-upgrade-assist']").click();
    await page.locator("[data-cy='plan-pay-link']").waitFor({ timeout: 60_000 });
    await expect.see("Waiting for the payment");
    const paid = await http("/api/me/plan/fake-paid", { method: "POST", headers: auth });
    await paid.body?.cancel();
    await page.locator("[data-cy='plan-check-paid']").click();
    await expect.see("Monster Assist is active");
    plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "assist" && plan.status === "active", `assist · active (${JSON.stringify(plan)})`);
  }));
