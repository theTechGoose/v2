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

/** REQ-099 — a plan's tier reaches the CRM by the sweep AFTER the reply: read the customer until it
 *  wears the tier (10 s at most), so the gate's workers cannot read the record before the sweep lands
 *  (REQ-118's gate did: "expected Monster, got Lead") */
async function crmCustomerWithTier(http: StoryTools["http"], auth: Record<string, string>, tier: string) {
  let customer = await crmCustomer(http, auth);
  for (let i = 0; i < 40 && customer?.tier !== tier; i++) {
    await new Promise((r) => setTimeout(r, 250));
    customer = await crmCustomer(http, auth);
  }
  return customer;
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

/** REQ-059 — pay on the page (the test card) and follow the receipt's "Back to DocuMonster" */
async function payAndGoBack(page: StoryTools["page"], expect: StoryTools["expect"]): Promise<void> {
  await expect.see("Test pay page");
  await expect.see("4111 1111 1111 1111");
  await page.locator("[data-cy='fake-pay']").click();
  await expect.see("Paid.");
  await expect.see("Back to DocuMonster");
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
    expect.eq(await page.locator("[data-cy^='plan-pick-']").count(), 3, "three cards: Monster, Monster Assist and Monster Assist+ (REQ-118 — and since REQ-119 this panel is the one place Monster Assist+ is a card)");
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

/** REQ-106 — a paid pick answers at once; the CRM's customer, due and pay link are minted by the
 *  sweep after the reply. Read the plan until its due is on it, 20 s at most — a story that pays
 *  by the fake's remote control (not through the hand-off page) must wait for it first, or the
 *  fake-paid answers 404 "nothing to pay" (the gate's find under load, REQ-122). */
async function untilDue(http: StoryTools["http"], auth: Record<string, string>): Promise<Record<string, unknown>> {
  const read = async () => await (await http("/api/me/plan", { headers: auth })).json() as Record<string, unknown>;
  let plan = await read();
  for (let i = 0; i < 80 && !plan.dueId; i++) {
    await new Promise((r) => setTimeout(r, 250));
    plan = await read();
  }
  return plan;
}

Deno.test("REQ-056: a paid plan goes back to free from the settings cards", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, { name: "Downgrade Story", email: `down-${digits()}@blackhole.postmarkapp.com` });
    // on Monster, paid and active
    const picked = await http("/api/me/plan", { method: "POST", headers: auth, body: JSON.stringify({ planId: "monster" }) });
    await picked.body?.cancel();
    const pending = await untilDue(http, auth);
    expect(typeof pending.dueId === "string", `the pick's due is on the plan before it is paid (${JSON.stringify(pending)})`);
    const paid = await http("/api/me/plan/fake-paid", { method: "POST", headers: auth });
    expect.eq(paid.status, 200, "the fake settles the due");
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
    // the frame the reviewer sees: the settled screen, free current and Monster a card again
    await page.locator("body").press("End");
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
    // Enter from the keyboard, not the locator: the runner stamps a frame after a locator press,
    // and that screenshot hangs 90 s when the page is already navigating to /verify (Playwright
    // 1.63; coms claude-tools 20261014T223413Z-w11-64121). The fill frame and the /verify page
    // that follows are the evidence.
    await page.keyboard.press("Enter");
    await page.waitForURL((u: URL) => u.pathname === "/verify", { timeout: 60_000 });
    await expect.see("Check your phone");
    // and that is all this person does — no code, no onboarding. The CRM already has them.
    const left = new Date().toISOString();
    await page.waitForTimeout(1500);
    // later, the same phone signs up: the lead is claimed, not duplicated
    const r = await http("/api/auth/verify", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ phoneNumber: phone, code: "000000" }) });
    const body = await r.json();
    const auth = { ...JSON_HEADERS, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
    // the sign-up's sync rides the outbox AFTER the reply (REQ-098): give the sweep a moment under the gate's workers
    let crm = await crmCustomer(http, auth);
    for (let i = 0; i < 40 && !(crm && crm.externalRef === `pm:${body.userId}`); i++) {
      await page.waitForTimeout(250);
      crm = await crmCustomer(http, auth);
    }
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
    // Enter from the keyboard, not the locator: the runner stamps a frame after a locator press,
    // and that screenshot hangs 90 s when the page is already navigating to /verify (Playwright
    // 1.63; coms claude-tools 20261014T223413Z-w11-64121). The fill frame and the /verify page
    // that follows are the evidence.
    await page.keyboard.press("Enter");
    await page.waitForURL((u: URL) => u.pathname === "/verify", { timeout: 60_000 });
    await expect.see("Check your phone");
    // the same phone signs up later, still without a name: the lead is claimed, the name stays
    const r = await http("/api/auth/verify", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ phoneNumber: phone, code: "000000" }) });
    const body = await r.json();
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    const auth = { ...JSON_HEADERS, cookie };
    // the sign-up's sync rides the outbox AFTER the reply (REQ-098): give the sweep a moment under the
    // gate's workers, the way REQ-060's story does (REQ-118's gate read the record before it landed)
    let crm = await crmCustomer(http, auth);
    for (let i = 0; i < 40 && !(crm && crm.externalRef === `pm:${body.userId}`); i++) {
      await page.waitForTimeout(250);
      crm = await crmCustomer(http, auth);
    }
    expect.eq(crm?.customerName, "unknown dragon mcdragonson", "the unfinished sign-up is the unnamed dragon");
    expect.eq(crm?.customerPhone, phone, "by phone");
    expect.eq(crm?.tier, "Lead", "a lead on the CRM");
    expect.eq(crm?.externalRef, `pm:${body.userId}`, "claimed by this account");
    // 2) the sign-up finished: name, business and email reach the record (REQ-058)
    const me = await http("/api/me", { method: "PUT", headers: auth, body: JSON.stringify({ language: "en", name: "Dragon Story", email: `dragon-${digits()}@blackhole.postmarkapp.com` }) });
    await me.body?.cancel();
    // the name reaches the record by the sweep, after the reply (REQ-098/099): read until it does,
    // 10 s at most — the first read raced the sweep under twelve workers (REQ-120's run)
    crm = await crmCustomer(http, auth);
    for (let i = 0; i < 40 && crm?.customerName !== "Dragon Story"; i++) {
      await page.waitForTimeout(250);
      crm = await crmCustomer(http, auth);
    }
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
    crm = await crmCustomerWithTier(http, auth, "Monster"); // the tier lands by the sweep (REQ-099)
    expect.eq(crm?.tier, "Monster", "a paying customer carries the plan as its tier");
    expect.eq(crm?.customerName, "Dragon Story", "the same record");
  }));

/** REQ-100 — the pay page's footer: the one account the charge goes through, printed by name */
async function payPageFooter(page: StoryTools["page"]): Promise<{ account: string; text: string }> {
  const footer = page.locator("[data-cy='fake-pay-account']");
  await footer.waitFor({ timeout: 60_000 });
  return { account: (await footer.getAttribute("data-account")) ?? "", text: (await footer.innerText()).trim() };
}

Deno.test("REQ-064: the test tier is nowhere on the site; /plan/test shows its one $1 card, the pay page carries the account (sandbox, REQ-101), and settings reads it paid once with no billing", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.goto("/?lang=en");
    await expect.see("Monster Free");
    expect.eq(await page.getByText("Monster Test").count(), 0, "not priced on the front page");
    const { auth } = await signIn(http, page, baseUrl, { name: "Test Tier Story", email: `tier-${digits()}@blackhole.postmarkapp.com` });
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    expect.eq(await page.locator("[data-cy='plan-pick-test']").count(), 0, "no test card in settings");
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 1, "the real plans are");
    // the one page that offers it; nothing named = the fake account, sandbox (REQ-101)
    await page.goto("/plan/test");
    await expect.see("Monster Test");
    await expect.see("$1");
    const payPage = await pickGoesToPayPage(page, "plan-pick-test");
    expect.eq(payPage.searchParams.get("account"), "sandbox", "the account rides on the pay page's url");
    await payAndGoBack(page, expect);
    await page.waitForURL((u: URL) => u.pathname === "/settings", { timeout: 60_000 });
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster Test");
    await expect.see("paid once");
    expect.eq(await page.locator("[data-cy='plan-pick-monster']").count(), 1, "the real plans stay cards");
    expect.eq(await page.locator("[data-cy='plan-pick-test']").count(), 0, "still no test card");
    const plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "test" && plan.status === "active" && plan.merchant === "sandbox" && !plan.subscriptionId, `test · active · sandbox, no billing (${JSON.stringify(plan)})`);
    const customer = await crmCustomer(http, auth);
    expect(customer.tier === "Lead", `the CRM tier stays Lead (${customer.tier})`);
  }));

/**
 * REQ-100 — "THE FOOTER SHOWS WHAT FUCKING MERCHANT ACCOUNT IS BEING USED. ONE FUCKING SOURCE OF
 * TRUTH SO IT CANNOT BE MIXED UP." A real customer's $99 (NMI 12670394611, 2026-10-12) went
 * through the sandbox account because an env var on Deploy said so while nothing on the page
 * did. Now: a plan pick names `primary`, the one rule in shared/quote-flow/merchant-accounts.ts;
 * the pay link carries that name on its url, the page prints it in its footer, and the plan's
 * record and the monthly billing carry the same name. No env var is read.
 */
Deno.test("REQ-100: a paid pick from onboarding lands on a pay page whose footer reads the one account the charge goes through — primary — the same name the pay link and the plan's record carry", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, { name: "Truth Story", email: `truth-${digits()}@blackhole.postmarkapp.com` });
    await page.goto("/welcome");
    await fillStep(page, "input.welcome__input", "Truth Roofing LLC");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("best email");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("Pick your plan");
    const payPage = await pickGoesToPayPage(page, "plan-pick-monster");
    expect.eq(payPage.searchParams.get("account"), "primary", "the link names the account on its url");
    const footer = await payPageFooter(page);
    expect.eq(footer.account, "primary", "the footer is bound to the link's account");
    expect(footer.text.toLowerCase().includes("primary"), `the footer prints the account by name (${footer.text})`); // drawn in capitals, as the CRM's footer is
    const pending = await (await http("/api/me/plan", { headers: auth })).json();
    expect(pending.status === "pending" && pending.merchant === "primary", `the plan's record says primary (${JSON.stringify(pending)})`);
    expect(new URL(pending.payUrl).searchParams.get("account") === "primary", "and holds the same link");
    await payAndGoBack(page, expect);
    await page.waitForURL((u: URL) => u.pathname === "/welcome", { timeout: 60_000 });
    await expect.see("Which state");
    const plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "monster" && plan.status === "active" && plan.merchant === "primary", `monster · active · primary (${JSON.stringify(plan)})`);
  }));

/**
 * REQ-101 — "PRIMARY IS THE ACUTAL ACCOUNT AND SANDBOX IS THE FAKE ACCOUNT BUT WE CAN ADD MORE."
 * The accounts are defined on the CRM's Accounts tab; the $1 test page charges sandbox unless its
 * address names another; a name the CRM has no record of is refused by name and nothing is charged.
 */
Deno.test("REQ-101: /plan/test charges sandbox unless its address names another account; ?merchant=primary charges primary; a name not on record is refused and nothing is charged", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, { name: "Accounts Story", email: `accounts-${digits()}@blackhole.postmarkapp.com` });
    // nothing named: the fake account
    await page.goto("/plan/test");
    await expect.see("Merchant account: sandbox");
    let payPage = await pickGoesToPayPage(page, "plan-pick-test");
    expect.eq(payPage.searchParams.get("account"), "sandbox", "sandbox on the url");
    expect.eq((await payPageFooter(page)).account, "sandbox", "sandbox in the footer");
    // the real account, named on the address
    await page.goto("/plan/test?merchant=primary");
    await expect.see("Merchant account: primary");
    payPage = await pickGoesToPayPage(page, "plan-pick-test");
    expect.eq(payPage.searchParams.get("account"), "primary", "primary on the url");
    expect.eq((await payPageFooter(page)).account, "primary", "primary in the footer");
    const primary = await (await http("/api/me/plan", { headers: auth })).json();
    expect(primary.planId === "test" && primary.merchant === "primary", `the record says primary (${JSON.stringify(primary)})`);
    // a name the CRM has no record of: refused by name, back on the page, nothing minted
    await page.goto("/plan/test?merchant=alpha");
    await expect.see("Merchant account: alpha");
    await page.locator("[data-cy='plan-pick-test']").click();
    // REQ-106 — the pick answers at once; the CRM's refusal reaches the hand-off page, which brings the person back saying why
    await page.waitForURL((u: URL) => u.pathname === "/settings" && u.searchParams.get("plan") === "merchant-unknown", { timeout: 60_000 });
    await expect.see("not on record");
    const after = await (await http("/api/me/plan", { headers: auth })).json();
    expect(after.payLinkError === "merchant-unknown" && !after.payUrl && after.merchant === "alpha", `the pick reads the refusal: nothing charged, nothing minted (${JSON.stringify(after)})`);
    // and the cards are offered again: a pick naming primary clears it
    await page.goto("/plan/test?merchant=primary");
    payPage = await pickGoesToPayPage(page, "plan-pick-test");
    expect.eq(payPage.searchParams.get("account"), "primary", "primary again");
  }));

/**
 * REQ-106 — Raphael, 2026-10-20: "when i click a plan in the onboarding flow the payment link takes
 * FOREVER to load, can we speed it up and keep the exact same result in the crm? i dont care if it
 * happens asyncronously it takes that amount of time anyway so as long as it ends up where its going
 * fine. what i care about is that the user experience is good."
 * The pick replies at once with a pending plan; the CRM's customer, due and pay link are minted by
 * the outbox's sweep after the reply; the browser waits on the hand-off page (/plan/pay), which
 * says the payment page is being prepared and moves there the moment it is. The fake link builder
 * is told to take its time (POST /me/plan/fake-slow, the fake's control like fake-paid), the way the
 * real CRM's cold start and Quickbase writes do.
 */
Deno.test("REQ-106: a paid pick answers at once — the hand-off page says the payment page is being prepared, and the person lands on it the moment it is ready; the CRM holds the same customer, due and link", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.goto("/");
    const { auth } = await signIn(http, page, baseUrl, { name: "Handoff Story", email: `handoff-${digits()}@blackhole.postmarkapp.com` });
    const slow = await http("/api/me/plan/fake-slow", { method: "POST", headers: auth, body: JSON.stringify({ ms: 4000 }) });
    await slow.body?.cancel();
    expect.eq(slow.status, 200, "the fake link builder takes four seconds from here on");
    await page.goto("/welcome");
    await fillStep(page, "input.welcome__input", "Handoff Builders");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("best email");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("Pick your plan");
    const t0 = Date.now();
    await page.locator("[data-cy='plan-pick-monster']").click();
    // the pick answered at once: the hand-off page, not the link builder's four seconds
    await page.waitForURL((u: URL) => u.pathname === "/plan/pay" && u.searchParams.get("back") === "/welcome", { timeout: 60_000 });
    const answered = Date.now() - t0;
    expect(answered < 3000, `the pick answered at once, not after the link builder (${answered} ms)`);
    await expect.see("Preparing your secure payment page");
    await expect.see("Monster · $99");
    const prepared = await (await http("/api/me/plan", { headers: auth })).json();
    expect(prepared.status === "pending" && !prepared.payUrl && prepared.merchant === "primary", `pending, the account decided, the page still to come (${JSON.stringify(prepared)})`);
    // the moment the page is ready the person is on it — the same link as before: customer, due, the way back, the account
    await page.waitForURL((u: URL) => u.pathname === "/pay/fake" && u.searchParams.has("customer") && u.searchParams.has("due"), { timeout: 60_000 });
    const arrived = Date.now() - t0;
    expect(arrived >= 4000, `the page came once the link builder was done, not before (${arrived} ms)`);
    const payPage = new URL(page.url());
    expect(payPage.searchParams.get("return")?.includes("/plan/return?due=") ?? false, `the link carries the way back (${payPage.searchParams.get("return")})`);
    expect.eq(payPage.searchParams.get("account"), "primary", "the account the pick decided");
    // paying there brings the person back with the plan active, as before
    await payAndGoBack(page, expect);
    await page.waitForURL((u: URL) => u.pathname === "/welcome", { timeout: 60_000 });
    await expect.see("Which state");
    const plan = await (await http("/api/me/plan", { headers: auth })).json();
    // REQ-061 — an active plan's payUrl is blank (nothing to pay while current): the page the hand-off opened is the plan's by its due and customer
    expect(plan.planId === "monster" && plan.status === "active" && plan.dueId === payPage.searchParams.get("due") && plan.customerId === payPage.searchParams.get("customer"), `monster · active, paid on the page the hand-off opened (${JSON.stringify(plan)})`);
    const customer = await crmCustomer(http, auth);
    expect(customer.customerId === plan.customerId && customer.customerName === "Handoff Builders", `the due was raised on the account's own customer, named by the business entered in onboarding (${JSON.stringify(customer)})`);
  }));

/**
 * REQ-118 — Raphael, 2026-10-22: "add another tier called monster assist + 399". Monster Assist+
 * is a $399 monthly tier of the one plan list, picked and paid like Monster and Monster Assist,
 * its name the CRM customer's tier once the first month is paid.
 * REQ-119 — Raphael, 2026-10-23: "the monster assist + is a hidden item that can only be shown in
 * the settings upgrade panel not on the onboarding panel." — hidden: not priced on any landing
 * page, no card in onboarding; the settings Plan panel is the one place it is a card.
 */
Deno.test("REQ-119: Monster Assist+ is hidden — not priced on the front page, on /landing or on /landing2, no card in onboarding; its one card is in the settings upgrade panel, where a pick goes to the pay page and, paid, is active with its tier on the CRM", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    // the front page: four cards from the one list, no Monster Assist+, no $399
    await page.goto("/?lang=en");
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    await expect.see("Monster Projects");
    await expect.notSee("Monster Assist+");
    await expect.notSee("$399");
    const names = (await page.locator("#pricing [data-cy='pricing-plan-name']").allTextContents()).map((s) => s.trim());
    expect.eq(names.join(" | "), "Monster Free | Monster | Monster Assist | Monster Projects", "four cards on the front page, in the list's order");
    // /landing: the same four
    await page.goto("/landing?lang=en");
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    await expect.see("Monster Projects");
    await expect.notSee("Monster Assist+");
    await expect.notSee("$399");
    const promo = (await page.locator("#pricing [data-cy='pricing-plan-name']").allTextContents()).map((s) => s.trim());
    expect.eq(promo.join(" | "), "Monster Free | Monster | Monster Assist | Monster Projects", "four cards on /landing, in the list's order");
    // /landing2: three cards, none of them Monster Assist+
    await page.goto("/landing2?lang=en");
    await page.locator("[data-cy='l2-plans']").scrollIntoViewIfNeeded();
    await expect.see("Monster Assist");
    await expect.notSee("Monster Assist+");
    await expect.notSee("$399");
    expect.eq(await page.locator("[data-cy='l2-plan']").count(), 3, "three plan cards");
    expect.eq(await page.locator("[data-cy='l2-plan'][data-plan='assist-plus']").count(), 0, "no card names assist-plus");
    // onboarding: Monster Free, Monster and Monster Assist — no $399 card
    const { auth } = await signIn(http, page, baseUrl, { name: "Plus Story", email: `plus-${digits()}@blackhole.postmarkapp.com` });
    await page.goto("/welcome");
    await fillStep(page, "input.welcome__input", "Plus Story Builders");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("best email");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("Pick your plan");
    await expect.see("$199");
    await expect.notSee("$399");
    expect.eq(await page.locator("[data-cy^='plan-pick-']").count(), 3, "three cards in onboarding: Monster Free, Monster and Monster Assist");
    expect.eq(await page.locator("[data-cy='plan-pick-assist-plus']").count(), 0, "no Monster Assist+ card in onboarding");
    // settings: the one place it is a card; the pick goes to the pay page in this tab; paid there, the receipt brings the person back with it active
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("$399");
    expect.eq(await page.locator("[data-cy^='plan-pick-']").count(), 3, "three paid cards: Monster, Monster Assist and Monster Assist+");
    expect.eq(await page.locator("[data-cy='plan-pick-assist-plus']").count(), 1, "Monster Assist+ is a card in the settings upgrade panel");
    const payPage = await pickGoesToPayPage(page, "plan-pick-assist-plus");
    expect.eq(payPage.searchParams.get("account"), "primary", "through the one real account (REQ-100)");
    await payAndGoBack(page, expect);
    await page.waitForURL((u: URL) => u.pathname === "/settings", { timeout: 60_000 });
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster Assist+ is active");
    expect.eq(await page.locator("[data-cy='plan-pick-assist-plus']").count(), 0, "no card for the active plan");
    expect.eq(await page.locator("[data-cy='plan-pick-assist']").count(), 1, "Monster Assist stays a card");
    const plan = await (await http("/api/me/plan", { headers: auth })).json();
    expect(plan.planId === "assist-plus" && plan.status === "active", `assist-plus · active (${JSON.stringify(plan)})`);
    const customer = await crmCustomerWithTier(http, auth, "Monster Assist+"); // the tier lands by the sweep (REQ-099)
    expect.eq(customer?.tier, "Monster Assist+", "the CRM's tier is the plan's name");
  }));
