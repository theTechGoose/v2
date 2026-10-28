/**
 * REQ-104 — Raphael, 2026-10-20: "Monster Free signup must get initial information and then
 * skip credit card ask." REQ-120 — Raphael, 2026-10-23: "okay now on /landing2 can you please
 * remove the logic that changes the onboarding, everything just ends up on the plan picker
 * onboarding page and they pick the plan there."
 *
 * Every button on /landing2 — the nav's Empezar gratis, the Monster Free card's, the paid cards'
 * Registrarme, the final CTA's, the sticky bar's — opens the same signup card, which says "Get
 * started in 30 seconds" (REQ-107) and names no plan: the code stores none, and the wizard asks
 * the initial information — the name, the business, the email — then its plan picker, the three
 * cards, where the person picks. Monster Free picked there is stored without a card ask and the
 * wizard goes on to the state; a paid plan picked there is its pay page, and the receipt brings
 * the person back with it active. The upgrade stays on /settings (REQ-054).
 *
 * On the fakes: the dev master code (000000) opens the account; the CRM is the in-process fake.
 */
import { story, type StoryTools } from "#shots";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };

/** the session the code left on the browser, as a header for the app's API */
async function sessionHeaders(
  page: StoryTools["page"],
): Promise<Record<string, string>> {
  const session = (await page.context().cookies()).find((c) =>
    c.name === "pm_session"
  );
  if (!session) throw new Error("no pm_session cookie after the code");
  return { cookie: `pm_session=${session.value}` };
}

/** an island may still be hydrating when its button appears: click until the page shows the effect.
 *  The effect may land between a poll and the next click and take the button with it (the code
 *  step replacing Send the code) — so each click is asked for again first and waits 2 s at most
 *  (the race REQ-118's third gate caught in landing2's twin of this helper). */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
    } catch {
      // the button is gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

/** a wizard text step: the island may still be hydrating when the input appears (a value typed
 *  before that leaves Continue disabled), so the fill is repeated until Continue takes it */
async function fillStep(
  page: StoryTools["page"],
  selector: string,
  value: string,
): Promise<void> {
  const input = page.locator(selector);
  await input.waitFor({ timeout: 60_000 });
  for (let attempt = 0; attempt < 8; attempt++) {
    await input.fill(value);
    try {
      await page.locator("[data-cy='welcome-continue']:not([disabled])")
        .waitFor({ timeout: 1500 });
      return;
    } catch { /* not hydrated yet — fill again */ }
  }
  throw new Error(`the wizard never took "${value}" at ${selector}`);
}

/** the way into the card: a plan card's button — the card is found by its id, the button carries
 *  no plan (REQ-120) — pressed until the page is at the signup card */
async function enterThrough(
  page: StoryTools["page"],
  planId: string,
): Promise<void> {
  await clickUntil(
    page,
    `[data-cy='l2-plan'][data-plan='${planId}'] [data-cy='l2-plan-cta']`,
    () => Promise.resolve(new URL(page.url()).hash === "#empezar"),
  );
}

/** sign up on the card with a fresh number — the phone, the code — and land in the wizard */
async function signUpOnCard(page: StoryTools["page"]): Promise<void> {
  await page.locator("#reg-phone").fill(`512${digits()}`);
  await page.locator("[data-cy='l2-send-code']").click();
  await page.locator("[data-cy='l2-signup-step'][data-step='2']").waitFor({
    timeout: 60_000,
  });
  await page.locator("#reg-code").fill("000000");
  await page.waitForURL((u: URL) => u.pathname === "/welcome", {
    timeout: 60_000,
  });
}

/** the served app answers as 127.0.0.1 (the gate's BASE_URL) AND as localhost (APP_URL — the host
 *  the fake's pay page and the return address are minted on, REQ-057/059): the session the code
 *  left on one name is carried to the other, so the pay page knows who is paying (REQ-059) */
async function carrySession(
  page: StoryTools["page"],
  baseUrl: string,
): Promise<void> {
  const cookies = (await page.context().cookies()).filter((c) =>
    c.name === "pm_session" || c.name === "pm_lang"
  );
  if (!cookies.some((c) => c.name === "pm_session")) {
    throw new Error("no pm_session cookie after the code");
  }
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) =>
      cookies.map((c) => ({ name: c.name, value: c.value, domain, path: "/" }))
    ),
  );
}

/** how many steps the wizard says it has */
const stepCount = async (page: StoryTools["page"]) =>
  await page.locator(".welcome__progressbar").getAttribute("aria-valuemax");

/** the plan on record for the signed-in account — null (an empty body) until a pick */
async function planOnRecord(
  http: StoryTools["http"],
  page: StoryTools["page"],
) {
  const text =
    await (await http("/api/me/plan", { headers: await sessionHeaders(page) }))
      .text();
  return text ? JSON.parse(text) : null;
}

/** what the CRM holds for the signed-in account — null until the sweep made it (REQ-098) */
async function crmCustomer(
  http: StoryTools["http"],
  page: StoryTools["page"],
) {
  const text = await (await http("/api/me/crm-customer", {
    headers: await sessionHeaders(page),
  })).text();
  return text ? JSON.parse(text) : null;
}

/** the CRM is written by the sweep after each reply (REQ-098/099): read until `done`, 20 s at most */
async function until<T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
): Promise<T> {
  let v = await read();
  for (let i = 0; i < 80 && !done(v); i++) {
    await new Promise((r) => setTimeout(r, 250));
    v = await read();
  }
  return v;
}

/** the wizard's first three questions — the name, the business, the email — answered for `who` */
async function nameBusinessEmail(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
  who: string,
): Promise<void> {
  await expect.see("what should we call you");
  await fillStep(page, "input.welcome__input", who);
  await page.locator("[data-cy='welcome-continue']").click();
  await expect.see("business called");
  await fillStep(page, "input.welcome__input", `${who} Roofing`);
  await page.locator("[data-cy='welcome-continue']").click();
  await expect.see("best email");
  await fillStep(
    page,
    "input[type='email']",
    `${who.toLowerCase().replace(/\s+/g, "-")}-${digits()}@blackhole.postmarkapp.com`,
  );
  await page.locator("[data-cy='welcome-continue']").click();
}

/**
 * REQ-120 — Raphael, 2026-10-23: "okay now on /landing2 can you please remove the logic that
 * changes the onboarding, everything just ends up on the plan picker onboarding page and they pick
 * the plan there." REQ-104's free with the code and REQ-113's carried paid name are gone: the
 * button pressed on the landing page decides nothing, the account carries no plan name, the CRM
 * says none yet, and the wizard's fourth step is the picker for everyone.
 */
Deno.test("REQ-120: no button on /landing2 changes onboarding — Registrarme on the $99 card and Empezar gratis alike open the same card, the code stores no plan, and the wizard's fourth step is the plan picker: Monster picked there goes to its pay page and comes back active; Monster Free picked there goes straight on to the state", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await expect.see("Get started in 30 seconds");
    // no button into the card names a plan, and the card signs up for none
    expect.eq(
      await page.locator("a[href='#empezar'][data-plan]").count(),
      0,
      "no button into the card names a plan",
    );
    expect.eq(
      await page.locator("[data-cy='l2-signup'][data-plan]").count(),
      0,
      "the card signs up for no plan",
    );
    // ── the $99 card's Registrarme ──
    await enterThrough(page, "monster");
    await signUpOnCard(page);
    await carrySession(page, baseUrl);
    await expect.see("what should we call you");
    expect.eq(
      await stepCount(page),
      "10",
      "ten steps: the plan is one of them — the picker",
    );
    const me = await (await http("/api/me", {
      headers: await sessionHeaders(page),
    })).json();
    expect(
      !("signupPlan" in me),
      `the account carries no plan name (${JSON.stringify(me)})`,
    );
    expect(
      await planOnRecord(http, page) === null,
      "nothing on record after the code",
    );
    // the CRM, by the sweep (REQ-098/111): a Lead, no plan yet
    const crm = await until(() => crmCustomer(http, page), (c) => c !== null);
    expect.eq(
      crm?.signupPlan,
      "none yet",
      "the CRM's Signup Plan waits on the picker",
    );
    expect.eq(crm?.tier, "Lead", "a Lead until a first month is paid");
    await nameBusinessEmail(page, expect, "Picker Story");
    // the fourth step is the picker — the three cards, nothing picked for the person
    await expect.see("Pick your plan");
    await expect.see("Step 4 of 10");
    expect.eq(
      await page.locator("[data-cy^='plan-pick-']").count(),
      3,
      "the three cards: Monster Free, Monster and Monster Assist",
    );
    expect.eq(
      await page.locator(
        "[data-cy='plan-pending'], [data-cy='plan-preparing']",
      ).count(),
      0,
      "no pay page, nothing prepared: the landing page picked nothing",
    );
    expect(
      await planOnRecord(http, page) === null,
      "still nothing on record: the email picked nothing",
    );
    // Monster picked here: the pay page in this tab, the wizard its way back (REQ-054/059)
    await page.locator("[data-cy='plan-pick-monster']").click();
    await page.waitForURL(
      (u: URL) =>
        u.pathname === "/pay/fake" && u.searchParams.has("customer") &&
        u.searchParams.has("due"),
      { timeout: 60_000 },
    );
    const back = new URL(page.url()).searchParams.get("return") ?? "";
    expect(
      back.includes("/plan/return?due=") && back.includes("back=%2Fwelcome"),
      `the link carries the way back to the wizard (${back})`,
    );
    const pending = await planOnRecord(http, page);
    expect(
      pending?.planId === "monster" && pending?.status === "pending" &&
        pending?.merchant === "primary",
      `Monster, pending through primary (${JSON.stringify(pending)})`,
    );
    await expect.see("Test pay page");
    await page.locator("[data-cy='fake-pay']").click();
    await expect.see("Paid.");
    await page.locator("[data-cy='fake-pay-back']").click();
    await page.waitForURL((u: URL) => u.pathname === "/welcome", {
      timeout: 60_000,
    });
    await expect.see("Which state");
    const paid = await planOnRecord(http, page);
    expect(
      paid?.planId === "monster" && paid?.status === "active",
      `Monster · active (${JSON.stringify(paid)})`,
    );

    // ── Empezar gratis, on a fresh browser ──
    await page.context().clearCookies();
    await page.goto("/landing2?lang=en");
    await expect.see("Get started in 30 seconds");
    await enterThrough(page, "free");
    await signUpOnCard(page);
    await expect.see("what should we call you");
    expect.eq(
      await stepCount(page),
      "10",
      "ten steps for this signup too: the plan is asked, not stored by the button",
    );
    expect(
      await planOnRecord(http, page) === null,
      "nothing on record: Empezar gratis stored no plan",
    );
    await nameBusinessEmail(page, expect, "Free Story");
    await expect.see("Pick your plan");
    await expect.see("Step 4 of 10");
    expect.eq(
      await page.locator("[data-cy='plan-pick-free']").count(),
      1,
      "Monster Free is a card to pick",
    );
    // Monster Free picked here: stored without a card ask, the wizard goes on to the state — the
    // six questions still open, counted alone (REQ-121: a question answered is not asked again)
    await page.locator("[data-cy='plan-pick-free']").click();
    await expect.see("Which state");
    await expect.see("Step 1 of 6");
    expect(!page.url().includes("/pay/"), `never a pay page (${page.url()})`);
    const free = await planOnRecord(http, page);
    expect(
      free !== null && free.planId === "free" && free.status === "free",
      `Monster Free on record, picked here (${JSON.stringify(free)})`,
    );
  }));

/**
 * REQ-107 — Raphael, 2026-10-20, on the shipped /landing2: "if you click start on the $99 it jumps
 * you to start free even though you ask, just change the text to get started." The $99 card's
 * Sign up opened the signup card titled Start free in 30 seconds with a Start free button; the
 * card's title, its button and its consent line say Get started / Empezar now, in both languages.
 * (REQ-120: the card signs up for no plan — the plan is picked in the wizard.)
 */
Deno.test("REQ-107: Sign up on the $99 card opens the signup card saying Get started — not Start free — in both languages; the buttons into the card keep their own words", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await expect.see("Get started in 30 seconds");
    await enterThrough(page, "monster");
    const card = page.locator("[data-cy='l2-signup']");
    expect.eq(((await card.locator("h2").first().textContent()) ?? "").trim(), "Get started in 30 seconds", "the title says Get started, not Start free");
    expect.eq(((await card.locator("[data-cy='l2-send-code']").textContent()) ?? "").trim(), "Get started", "the button too");
    const consent = ((await page.locator("label[for='reg-consent']").textContent()) ?? "").trim();
    expect(/By tapping Get started/.test(consent), `the consent line names the button by its new name (${consent.slice(0, 60)})`);
    for (const text of [await card.locator("h2").first().textContent(), await card.locator("[data-cy='l2-send-code']").textContent(), consent]) {
      expect(!/free/i.test(text ?? ""), `nothing on the card says free (${(text ?? "").slice(0, 60)})`);
    }
    // and in Spanish
    await page.goto("/landing2?lang=es");
    await expect.see("Empieza en 30 segundos");
    await enterThrough(page, "monster");
    expect.eq(((await card.locator("[data-cy='l2-send-code']").textContent()) ?? "").trim(), "Empezar", "Empezar, not Empezar gratis");
    expect(!/gratis/i.test(((await card.locator("h2").first().textContent()) ?? "")), "the title does not say gratis");
    // the buttons INTO the card keep their own words: the Monster Free card starts free, the paid cards sign up
    const cta = (id: string) => page.locator(`[data-cy='l2-plan'][data-plan='${id}'] [data-cy='l2-plan-cta']`);
    expect.eq(((await cta("free").textContent()) ?? "").trim(), "Empezar gratis", "the Monster Free card's button still says Empezar gratis");
    expect.eq(((await cta("monster").textContent()) ?? "").trim(), "Registrarme", "the $99 card's button says Registrarme");
  }));

/**
 * REQ-111 — Raphael, 2026-10-21, the launch checklist: "CRITICAL — Save incomplete signups. For
 * Monster Free, Monster, and Monster Assist, save any and all information collected, even if the
 * customer does not complete signup. Capture contact information as early as possible so we can
 * call and help them finish. Include their selected plan and the exact stage they reached so the
 * team knows how to follow up. Make these incomplete signups accessible to the team."
 * The CRM customer the sign-up made (REQ-058) carries, after every save, the selected plan and the
 * exact stage; a Monster Free account sits on the CRM ladder's Free rung. The fake CRM echoes what
 * it was told; the real one shows the two beside the lead once it holds the columns (its own REQ).
 * REQ-120: the plan is the one picked in the wizard — Monster Free here, at the picker.
 */
Deno.test("REQ-111: a Monster Free signup that picks its plan and stops at the state is on the CRM with its plan, its stage — 4 of 9 answered, next the state — and everything typed so far", (t) =>
  story(t, async ({ page, expect, http }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await enterThrough(page, "free");
    await signUpOnCard(page);
    await nameBusinessEmail(page, expect, "Stage Story");
    await expect.see("Pick your plan");
    await page.locator("[data-cy='plan-pick-free']").click();
    await expect.see("Which state");
    // … and the person leaves. The CRM already has them, with the plan and the stage: the sync rides
    // the outbox after each reply (REQ-098/099), so the record is read until it says so — up to
    // 20 s, in its own lane whatever the other stories' accounts are doing on the CRM (REQ-111)
    const crm = await until(
      () => crmCustomer(http, page),
      (c) => c !== null && c.signupStage === "4 of 9 answered — next the state",
    );
    expect(crm !== null, "the CRM knows the account");
    expect.eq(crm.signupPlan, "Monster Free", "the selected plan is on the record");
    expect.eq(crm.signupStage, "4 of 9 answered — next the state", "the exact stage reached");
    expect.eq(crm.tier, "Free", "on the CRM ladder's Free rung");
    expect.eq(crm.customerName, "Stage Story Roofing", "the business typed so far");
    expect.eq(crm.contact, "Stage Story", "the person typed so far");
    expect(typeof crm.customerEmail === "string" && crm.customerEmail.startsWith("stage-"), `the email typed so far (${crm.customerEmail})`);
  }));
