/**
 * REQ-054 — "we want to use the link builder so in onboarding a user can pick their plan. they
 * can pick free but later can upgrade to paid in the settings panel."
 * REQ-055 — "upgrade to monster 99 ect should just be cards and open the payment page."
 *
 * The pages: the /welcome wizard's plan step (front-end/islands/WelcomeWizard.tsx) and the Plan
 * card on /settings (front-end/islands/SettingsPage.tsx), both rendering the one PlanCards
 * component. The gate runs on the fakes: the CRM behind the pay link is the in-process fake
 * (PPWK_PAYMENTS_URL unset), and its one remote control, POST /api/me/plan/fake-paid, is what
 * settles the due the way a card on the real pay page would.
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
  // the served app answers as 127.0.0.1 (the gate's BASE_URL) AND as localhost (APP_URL, the
  // launcher's frontend — the host the fake's pay page is minted on, REQ-057): one app, both names
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

/** REQ-055 — click a plan card, wait for the tab it opens to land on the pay page — on fakes the
 *  app's own /pay/fake (REQ-057) — and hand back that url (the tab is closed again: the story
 *  stays on the app's page). */
async function pickOpensPayPage(page: StoryTools["page"], card: string): Promise<string> {
  const [tab] = await Promise.all([
    page.waitForEvent("popup", { timeout: 60_000 }),
    page.locator(`[data-cy='${card}']`).click(),
  ]);
  await tab.waitForURL((u: URL) => u.pathname === "/pay/fake" && u.searchParams.has("customer") && u.searchParams.has("due"), { timeout: 60_000 });
  const url = tab.url();
  await tab.close();
  return url;
}

Deno.test("REQ-054: in onboarding the person picks a paid plan, pays on the link builder's page, and the plan is active", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    // the person starts on the site's front page, where the same plans are priced
    await page.goto("/");
    await expect.see("Monster Free");
    await expect.see("Monster Assist");
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
    // the paid pick opens the CRM's pay page — the link builder's link — itself (REQ-055)
    const opened = await pickOpensPayPage(page, "plan-pick-monster");
    expect(opened.includes("/pay/fake?customer="), `the tab opened on the pay page (${opened})`);
    await expect.see("Waiting for the payment");
    const href = await page.locator("[data-cy='plan-pay-link']").getAttribute("href");
    expect.eq(href, opened, "the card's link reopens the same pay page");
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

    // later, the settings panel: the paid plans are cards, and the pick opens the pay page (REQ-055)
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster Free");
    const opened = await pickOpensPayPage(page, "plan-pick-assist");
    expect(opened.includes("/pay/fake?customer="), `the tab opened on the pay page (${opened})`);
    await expect.see("Waiting for the payment");
    const paid = await http("/api/me/plan/fake-paid", { method: "POST", headers: auth });
    await paid.body?.cancel();
    await page.locator("[data-cy='plan-check-paid']").click();
    await expect.see("Monster Assist is active");
    plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "assist" && plan.status === "active", `assist · active (${JSON.stringify(plan)})`);
  }));

Deno.test("REQ-055: on settings the paid plans are cards and picking one opens the payment page", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl, { name: "Cards Story", email: `cards-${digits()}@blackhole.postmarkapp.com` });
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    // the current plan, then the two paid plans as the same cards onboarding shows: name, price, features
    await expect.see("Current plan");
    await expect.see("Monster Free");
    await expect.see("$99");
    await expect.see("$199");
    await expect.see("Everything in Monster Free");
    await expect.see("Phone, text & email help from our team");
    expect.eq(await page.locator("[data-cy^='plan-pick-']").count(), 2, "two cards: Monster and Monster Assist");
    await expect.notSee("Upgrade to Monster");
    // the card is the pick AND the way to the pay page: one click opens it
    const opened = await pickOpensPayPage(page, "plan-pick-monster");
    expect(opened.includes("/pay/fake?customer="), `the tab opened on the pay page (${opened})`);
    await expect.see("Waiting for the payment");
    const href = await page.locator("[data-cy='plan-pay-link']").getAttribute("href");
    expect.eq(href, opened, "the card's link reopens the same pay page");
    // while it waits the other paid plan is still a card (a change of mind opens ITS pay page);
    // the plan being paid for is the pending line, not a card
    expect.eq(await page.locator("[data-cy='plan-pick-assist']").count(), 1, "Monster Assist is still a card while Monster is pending");
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 0, "no card for the plan being paid for");
    // the person pays ON that page (REQ-057: the app's stand-in for the CRM's charge page — the
    // test card and one Pay button), then checks on settings
    // the pay page is on APP_URL's host (localhost) while the story's app is 127.0.0.1: the
    // island's language comes from that origin's localStorage (lang.ts), empty here, so the
    // page is asked for English the way the EN/ES switch does — ?lang=
    await page.goto(opened + "&lang=en");
    await expect.see("Test pay page");
    await expect.see("4111 1111 1111 1111");
    await page.locator("[data-cy='fake-pay']").click();
    await expect.see("Paid. Go back to the app");
    await page.locator("[data-cy='fake-pay-back']").click();
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    // the fake settles the due the moment the card lands, so settings already reads active
    // (on the real CRM the person presses "Check payment" here)
    await expect.see("Monster is active");
    // the active plan's card is gone; the other paid plan is still a card
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 0, "no card for the plan that is active");
    expect.eq(await page.locator("[data-cy='plan-pick-assist']").count(), 1, "Monster Assist stays a card");
    const plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "monster" && plan.status === "active", `monster · active (${JSON.stringify(plan)})`);
  }));

Deno.test("REQ-056: a paid plan goes back to free from the settings cards", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl, { name: "Downgrade Story", email: `down-${digits()}@blackhole.postmarkapp.com` });
    // on Monster, paid and active
    const picked = await http("/api/me/plan", { method: "POST", headers: auth, body: JSON.stringify({ planId: "monster" }) });
    await picked.body?.cancel();
    const paid = await http("/api/me/plan/fake-paid", { method: "POST", headers: auth });
    await paid.body?.cancel();
    const refreshed = await http("/api/me/plan/refresh", { method: "POST", headers: auth });
    await refreshed.body?.cancel();
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster is active");
    // every other plan is a card — Monster Free among them
    expect.eq(await page.locator("[data-cy='plan-pick-free']").count(), 1, "Monster Free is a card on a paid plan");
    expect.eq(await page.locator("[data-cy='plan-pick-assist']").count(), 1, "Monster Assist is a card");
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 0, "no card for the active plan");
    // one click: free, nothing to pay, no tab
    await page.locator("[data-cy='plan-pick-free']").click();
    await expect.see("Free — upgrade any time.");
    expect.eq(await page.locator("[data-cy='plan-pick-free']").count(), 0, "the free card is gone once free is current");
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 1, "Monster is a card again");
    const plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "free" && plan.status === "free", `free · free (${JSON.stringify(plan)})`);
  }));
