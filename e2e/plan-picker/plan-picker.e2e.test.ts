/**
 * REQ-054 — "we want to use the link builder so in onboarding a user can pick their plan. they
 * can pick free but later can upgrade to paid in the settings panel."
 * REQ-055 — "upgrade to monster 99 ect should just be cards and open the payment page."
 * REQ-058 — "when someone signs up it should build them as a customer then add their info when
 * they finish the onboarding"
 * REQ-059 — "v2 should redirect to the ui … the payments should be seamless between both apps."
 * REQ-062 — "sign up free, close the browser before finishing sign up. customer phone number in
 * quickbase as 'unknown dragon mcdragonson' … sign up paid … guest info updated in quickbase with tier"
 *
 * The pages: the /welcome wizard (front-end/islands/WelcomeWizard.tsx) and the Plan card on
 * /settings (front-end/islands/SettingsPage.tsx), both rendering the one PlanCards component;
 * a card posts to the Fresh route front-end/routes/plan/pick.tsx (the redirect to the pay page)
 * and the receipt comes back through front-end/routes/plan/return.tsx (REQ-059).
 * The gate runs on the fakes: the CRM behind the pay link is the in-process fake (PPWK_PAYMENTS_URL
 * unset) — it upserts customers by this app's ref and mints the app's own /pay/fake page
 * (REQ-057) carrying the return address, the way the real link builder does — and that page's
 * one Pay button settles the due the way a card on the real pay page would.
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
  // launcher's frontend — the host the fake's pay page and the return address are minted on,
  // REQ-057/059): one app, both names
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return { auth, phone, userId: body.userId as string };
}

/** what the CRM holds for the signed-in account (REQ-058) */
async function crmCustomer(http: StoryTools["http"], auth: Record<string, string>) {
  return await (await http("/api/me/crm-customer", { headers: auth })).json();
}

/** REQ-059 — click a plan card (a form: the pick is a redirect): THIS tab goes to the pay page —
 *  on fakes the app's own /pay/fake (REQ-057), carrying the customer, the due and the way back.
 *  Hands back that url. */
async function pickGoesToPayPage(page: StoryTools["page"], card: string): Promise<URL> {
  await page.locator(`[data-cy='${card}']`).click();
  await page.waitForURL((u: URL) => u.pathname === "/pay/fake" && u.searchParams.has("customer") && u.searchParams.has("due"), { timeout: 60_000 });
  return new URL(page.url());
}

/** a wizard text step: the island may still be hydrating when the input appears (a value typed
 *  before that leaves Continue disabled), so the fill is repeated until Continue takes it */
async function fillStep(page: StoryTools["page"], selector: string, value: string): Promise<void> {
  const input = page.locator(selector);
  await input.waitFor({ timeout: 60_000 });
  for (let attempt = 0; attempt < 8; attempt++) {
    await input.fill(value);
    try {
      await page.locator("[data-cy='welcome-continue']:not([disabled])").waitFor({ timeout: 1500 });
      return;
    } catch { /* not hydrated yet — fill again */ }
  }
  throw new Error(`the wizard never took "${value}" at ${selector}`);
}

/** REQ-059 — pay on the page (the test card) and follow the receipt's "Back to Paperwork Monster" */
async function payAndGoBack(page: StoryTools["page"], expect: StoryTools["expect"]): Promise<void> {
  await expect.see("Test pay page");
  await expect.see("4111 1111 1111 1111");
  await page.locator("[data-cy='fake-pay']").click();
  await expect.see("Paid.");
  await expect.see("Back to Paperwork Monster");
  await page.locator("[data-cy='fake-pay-back']").click();
}

Deno.test("REQ-058: a sign-up is a CRM customer at once — the phone and this app's ref — and onboarding fills the name and email in", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, phone, userId } = await signIn(http, page, baseUrl, {});
    // the moment the account exists the CRM has its customer: nothing but the phone to go on yet
    let customer = await crmCustomer(http, auth);
    // REQ-062 — a person who has given no name is "unknown dragon mcdragonson", by phone
    expect(customer && customer.customerName === "unknown dragon mcdragonson", `the customer is the unnamed one (${JSON.stringify(customer)})`);
    expect(customer.externalRef === `pm:${userId}`, `it carries this app's ref (${customer.externalRef})`);
    expect(customer.customerEmail === "", "no email invented");
    const customerId = customer.customerId as string;
    // onboarding: the person's name …
    await page.goto("/welcome");
    await fillStep(page, "input.welcome__input", "Story Person");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("business called");
    customer = await crmCustomer(http, auth);
    expect(customer.customerName === "Story Person", `the name is the customer's name now (${customer.customerName})`);
    expect(customer.customerId === customerId, "the same customer, revised — never a second one");
    // … the business name, which takes over …
    await fillStep(page, "input.welcome__input", "Story Roofing LLC");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("best email");
    customer = await crmCustomer(http, auth);
    expect(customer.customerName === "Story Roofing LLC", `the business is the customer's name (${customer.customerName})`);
    // … and the email
    const email = `story-${digits()}@blackhole.postmarkapp.com`;
    await fillStep(page, "input[type='email']", email);
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("Pick your plan");
    customer = await crmCustomer(http, auth);
    expect(customer.customerEmail === email, `the email reached the customer (${customer.customerEmail})`);
    expect(customer.customerPhone === phone && customer.customerId === customerId, "phone kept, same record");
  }));

Deno.test("REQ-054: in onboarding the person picks a paid plan, pays on the link builder's page, and comes back with the plan active", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    // the person starts on the site's front page, where the same plans are priced
    await page.goto("/");
    await expect.see("Monster Free");
    await expect.see("Monster Assist");
    const { auth } = await signIn(http, page, baseUrl, { name: "Plan Story", email: `plan-${digits()}@blackhole.postmarkapp.com` });
    await page.goto("/welcome");
    // the wizard resumes at the first incomplete step: the business name; the email is on file,
    // so its step is prefilled — continue; then the plan
    await fillStep(page, "input.welcome__input", "Plan Story Builders");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("best email");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("Pick your plan");
    await expect.see("Monster Free");
    await expect.see("$99");
    await expect.see("$199");
    // the paid pick GOES to the pay page — the link builder's link — in this tab (REQ-055/059)
    const payPage = await pickGoesToPayPage(page, "plan-pick-monster");
    expect(payPage.searchParams.get("return")?.includes("/plan/return?due="), `the link carries the way back (${payPage.searchParams.get("return")})`);
    // the person pays on the pay page; the receipt brings them back — to the wizard, which has
    // moved past the plan: nothing to check, nothing to press
    await payAndGoBack(page, expect);
    await page.waitForURL((u: URL) => u.pathname === "/welcome", { timeout: 60_000 });
    await expect.see("Which state");
    const plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "monster" && plan.status === "active", `the record says monster · active (${JSON.stringify(plan)})`);
    // and the CRM customer the payment was taken on is the one sign-up made for this account
    const customer = await crmCustomer(http, auth);
    expect(customer.customerId === plan.customerId, `the due was raised on the account's own customer (${customer.customerId} vs ${plan.customerId})`);
    expect(customer.customerName === "Plan Story Builders", `named by the business entered in onboarding (${customer.customerName})`);
  }));

Deno.test("REQ-054: free in onboarding, then upgraded to a paid plan from the settings panel", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, { name: "Free Story", email: `free-${digits()}@blackhole.postmarkapp.com` });
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

    // later, the settings panel: the paid plans are cards, and the pick goes to the pay page (REQ-055/059)
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster Free");
    await pickGoesToPayPage(page, "plan-pick-assist");
    await payAndGoBack(page, expect);
    // the receipt brings the person back to settings, where the plan already reads active
    await page.waitForURL((u: URL) => u.pathname === "/settings", { timeout: 60_000 });
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster Assist is active");
    plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "assist" && plan.status === "active", `assist · active (${JSON.stringify(plan)})`);
  }));

Deno.test("REQ-055 + REQ-059: on settings the paid plans are cards; a pick goes to the payment page in this tab, and the receipt brings the person back with the plan active — no check button", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, { name: "Cards Story", email: `cards-${digits()}@blackhole.postmarkapp.com` });
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
    // the card is the pick AND the way to the pay page: one click, this tab
    const payPage = await pickGoesToPayPage(page, "plan-pick-monster");
    // a change of mind before paying: back on settings the pick waits, with the way back to its
    // page — and nothing to "check"
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Waiting for the payment");
    await expect.see("Resume payment");
    expect.eq(await page.locator("[data-cy='plan-pay-link']").getAttribute("href"), payPage.toString(), "the link resumes the same pay page");
    expect.eq(await page.locator("[data-cy='plan-check-paid']").count(), 0, "no 'Check payment' button: the receipt brings the person back");
    expect.eq(await page.locator("[data-cy='plan-pick-assist']").count(), 1, "Monster Assist is still a card while Monster is pending");
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 0, "no card for the plan being paid for");
    // resume: the page again, in this tab; pay; the receipt brings the person back to settings
    await page.locator("[data-cy='plan-pay-link']").click();
    await page.waitForURL((u: URL) => u.pathname === "/pay/fake", { timeout: 60_000 });
    await payAndGoBack(page, expect);
    await page.waitForURL((u: URL) => u.pathname === "/settings", { timeout: 60_000 });
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster is active");
    // the active plan's card is gone; the other paid plan is still a card
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 0, "no card for the plan that is active");
    expect.eq(await page.locator("[data-cy='plan-pick-assist']").count(), 1, "Monster Assist stays a card");
    const plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "monster" && plan.status === "active", `monster · active (${JSON.stringify(plan)})`);
  }));

Deno.test("REQ-056: a paid plan goes back to free from the settings cards", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, { name: "Downgrade Story", email: `down-${digits()}@blackhole.postmarkapp.com` });
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
    // one click: free, nothing to pay, no page to go to
    await page.locator("[data-cy='plan-pick-free']").click();
    await expect.see("Free — upgrade any time.");
    expect.eq(await page.locator("[data-cy='plan-pick-free']").count(), 0, "the free card is gone once free is current");
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 1, "Monster is a card again");
    const plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "free" && plan.status === "free", `free · free (${JSON.stringify(plan)})`);
  }));

Deno.test("REQ-060: the phone typed into login is a CRM customer before any code is entered; the sign-up with that phone becomes the same customer", (t) =>
  story(t, async ({ page, expect, http }) => {
    const phone = `+1512${digits()}`;
    await page.goto("/?lang=en");
    const box = page.getByRole("textbox", { name: /phone/i });
    await box.waitFor({ timeout: 60_000 });
    await box.fill(phone.slice(2));
    await box.press("Enter");
    await page.waitForURL((u: URL) => u.pathname === "/verify", { timeout: 60_000 });
    await expect.see("Check your phone");
    // and that is all this person does — no code, no onboarding. The CRM already has them.
    const left = new Date().toISOString();
    await page.waitForTimeout(1500);
    // later, the same phone signs up: the lead is claimed, not duplicated
    const r = await http("/api/auth/verify", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ phoneNumber: phone, code: "000000" }) });
    const body = await r.json();
    const auth = { ...JSON_HEADERS, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
    const crm = await crmCustomer(http, auth);
    expect(crm !== null, "the CRM knows the account");
    expect.eq(crm.customerPhone, phone, "by its phone");
    expect.eq(crm.externalRef, `pm:${body.userId}`, "now carrying this app's ref");
    expect(typeof crm.createdAt === "string" && crm.createdAt < left, `made when the phone was typed, before the person left (${crm.createdAt} < ${left})`);
  }));

Deno.test("REQ-061: a month later the card on file is charged by itself and settings shows the next bill; with the card gone the month is past due — Pay now opens the page, and paying it makes the plan current again", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, { name: "Monthly Story", email: `monthly-${digits()}@blackhole.postmarkapp.com` });
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await pickGoesToPayPage(page, "plan-pick-monster");
    await payAndGoBack(page, expect);
    await page.waitForURL((u: URL) => u.pathname === "/settings", { timeout: 60_000 });
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster is active");
    await expect.see("next bill");
    await expect.see("•••• 1111");
    let plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(typeof plan.subscriptionId === "string" && plan.subscriptionId.length > 0, `the billing started (${JSON.stringify(plan)})`);
    const firstNext = plan.nextBillAt as string;
    expect(firstNext > plan.activatedAt, "the first recurring month is after activation");
    // the clock, a month on: the card on file is charged and the next bill moves a month
    plan = await (await http("/api/me/plan/fake-bill", { method: "POST", headers: auth, body: JSON.stringify({ now: firstNext }) })).json();
    expect.eq(plan.status, "active", "still current");
    expect(plan.nextBillAt > firstNext, "the next bill is the month after");
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see(`next bill ${String(plan.nextBillAt).slice(0, 10)}`);
    // the card is gone: the month after cannot be collected — past due, with Pay now
    plan = await (await http("/api/me/plan/fake-bill", { method: "POST", headers: auth, body: JSON.stringify({ now: plan.nextBillAt, cardGone: true }) })).json();
    expect.eq(plan.status, "past_due", "the month is past due");
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("didn't go through");
    await expect.see("Pay now");
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 0, "Monster is still the plan");
    await page.locator("[data-cy='plan-pay-link']").click();
    await page.waitForURL((u: URL) => u.pathname === "/pay/fake", { timeout: 60_000 });
    await payAndGoBack(page, expect);
    await page.waitForURL((u: URL) => u.pathname === "/settings", { timeout: 60_000 });
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await page.locator("[data-cy='plan-status']").waitFor({ timeout: 60_000 });
    const said = await page.locator("[data-cy='plan-status']").innerText();
    expect(said.includes("is active"), `the plan card says: "${said}" at ${page.url()}`);
    await expect.notSee("Pay now");
    plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect.eq(plan.status, "active", "current again");
  }));

Deno.test("REQ-062: a person who never finishes is 'unknown dragon mcdragonson' on the CRM, tier Lead; once the first month is paid the tier is the plan's name", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    // 1) the phone goes into login and the person closes the browser: a lead, by phone, unnamed
    const phone = `+1512${digits()}`;
    await page.goto("/?lang=en");
    const box = page.getByRole("textbox", { name: /phone/i });
    await box.waitFor({ timeout: 60_000 });
    await box.fill(phone.slice(2));
    await box.press("Enter");
    await page.waitForURL((u: URL) => u.pathname === "/verify", { timeout: 60_000 });
    await expect.see("Check your phone");
    // the same phone signs up later, still without a name: the lead is claimed, the name stays
    const r = await http("/api/auth/verify", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ phoneNumber: phone, code: "000000" }) });
    const body = await r.json();
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    const auth = { ...JSON_HEADERS, cookie };
    let crm = await crmCustomer(http, auth);
    expect.eq(crm?.customerName, "unknown dragon mcdragonson", "the unfinished sign-up is the unnamed dragon");
    expect.eq(crm?.customerPhone, phone, "by phone");
    expect.eq(crm?.tier, "Lead", "a lead on the CRM");
    expect.eq(crm?.externalRef, `pm:${body.userId}`, "claimed by this account");
    // 2) the sign-up finished: name, business and email reach the record (REQ-058)
    const me = await http("/api/me", { method: "PUT", headers: auth, body: JSON.stringify({ language: "en", name: "Dragon Story", email: `dragon-${digits()}@blackhole.postmarkapp.com` }) });
    await me.body?.cancel();
    crm = await crmCustomer(http, auth);
    expect.eq(crm?.customerName, "Dragon Story", "named once the person says who they are");
    expect.eq(crm?.tier, "Lead", "still a lead: nothing paid");
    // 3) the paid pick, the card on the page, the receipt back: the tier is the plan
    const [name, value] = cookie.split("=");
    const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
    await page.context().addCookies([...hosts].flatMap((domain) => [{ name, value, domain, path: "/" }, { name: "pm_lang", value: "en", domain, path: "/" }]));
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await pickGoesToPayPage(page, "plan-pick-monster");
    await payAndGoBack(page, expect);
    await page.waitForURL((u: URL) => u.pathname === "/settings", { timeout: 60_000 });
    await expect.see("Monster is active");
    crm = await crmCustomer(http, auth);
    expect.eq(crm?.tier, "Monster", "a paying customer carries the plan as its tier");
    expect.eq(crm?.customerName, "Dragon Story", "the same record");
  }));

Deno.test("REQ-064: the test tier is nowhere on the site; /plan/test?merchant=alpha shows its one $1 card, the pay page carries the merchant, and settings reads it paid once with no billing", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.goto("/?lang=en");
    await expect.see("Monster Free");
    expect.eq(await page.getByText("Monster Test").count(), 0, "not priced on the front page");
    const { auth } = await signIn(http, page, baseUrl, { name: "Test Tier Story", email: `tier-${digits()}@blackhole.postmarkapp.com` });
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    expect.eq(await page.locator("[data-cy='plan-pick-test']").count(), 0, "no test card in settings");
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 1, "the real plans are");
    // the one page that offers it, with the merchant account as its query param
    await page.goto("/plan/test?merchant=alpha");
    await expect.see("Monster Test");
    await expect.see("$1");
    const payPage = await pickGoesToPayPage(page, "plan-pick-test");
    expect.eq(payPage.searchParams.get("merchant"), "alpha", "the merchant rides on the pay page's url");
    await payAndGoBack(page, expect);
    await page.waitForURL((u: URL) => u.pathname === "/settings", { timeout: 60_000 });
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster Test");
    await expect.see("paid once");
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 1, "the real plans stay cards");
    expect.eq(await page.locator("[data-cy='plan-pick-test']").count(), 0, "still no test card");
    const plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "test" && plan.status === "active" && plan.merchant === "alpha" && !plan.subscriptionId, `test · active · alpha, no billing (${JSON.stringify(plan)})`);
    const customer = await crmCustomer(http, auth);
    expect(customer.tier === "Lead", `the CRM tier stays Lead (${customer.tier})`);
  }));
