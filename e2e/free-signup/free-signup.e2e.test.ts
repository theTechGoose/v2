/**
 * REQ-104 — Raphael, 2026-10-20: "Monster Free signup must get initial information and then
 * skip credit card ask."
 *
 * The signup card on /landing2 is a Monster Free signup — it says "Empieza en 30 segundos" (REQ-107) — and
 * so is every Empezar gratis button into it (the nav's, the Monster Free card's, the final CTA's,
 * the sticky bar's); a paid card's Registrarme is not. A Monster Free signup names free with the
 * code, the backend stores Monster Free on the new account, and the wizard asks the initial
 * information — the name, the business, the email, then the state and the rest — without ever
 * showing the plan cards or the pay page behind the paid ones. The upgrade stays on /settings
 * (REQ-054). REQ-113: a paid card's Sign up carries its plan — the account names it from the code
 * on, the pick is made the moment the wizard has the email, and the plan step is that plan's
 * payment page, never the cards.
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

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.locator(selector).click();
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

/** the way into the card: the button named by its plan, pressed until the card says it signs up for that plan */
async function enterThrough(
  page: StoryTools["page"],
  planId: string,
): Promise<void> {
  await clickUntil(
    page,
    `[data-cy='l2-plan-cta'][data-plan='${planId}']`,
    async () =>
      (await page.locator("[data-cy='l2-signup']").getAttribute(
        "data-plan",
      )) === planId,
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
 *  left on one name is carried to the other, so the pay page knows who is paying (REQ-113) */
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

Deno.test("REQ-104: a Monster Free signup on /landing2 — Empezar gratis — gets the initial information and never meets the plan cards or the pay page: name, business, email, then straight to the state; the plan reads Monster Free; the upgrade waits on settings", (t) =>
  story(t, async ({ page, expect, http }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await expect.see("Get started in 30 seconds");
    // the card signs up for Monster Free as the page opens; the Monster Free card's button says so too
    expect.eq(
      await page.locator("[data-cy='l2-signup']").getAttribute("data-plan"),
      "free",
      "the card is a Monster Free signup when the page opens",
    );
    expect.eq(
      await page.locator("a[href='#empezar'][data-plan='free']").count(),
      5,
      "the nav, the Monster Free card, the final CTA, the sticky bar and the demo card's Get started now → (REQ-116) all start free",
    );
    await enterThrough(page, "free");
    await signUpOnCard(page);
    // the wizard asks the initial information — nine steps, the plan not among them
    await expect.see("what should we call you");
    expect.eq(
      await stepCount(page),
      "9",
      "nine steps: the plan is not one of them",
    );
    await expect.see("Step 1 of 9");
    await fillStep(page, "input.welcome__input", "Free Story");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("business called");
    await fillStep(page, "input.welcome__input", "Free Story Roofing");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("best email");
    await fillStep(
      page,
      "input[type='email']",
      `free-${digits()}@blackhole.postmarkapp.com`,
    );
    await page.locator("[data-cy='welcome-continue']").click();
    // … and after the email comes the state: no "Pick your plan", no cards, no pay page
    await expect.see("Which state");
    await expect.see("Step 4 of 9");
    expect.eq(
      await page.locator("[data-cy^='plan-pick-']").count(),
      0,
      "no plan card was shown",
    );
    expect(!page.url().includes("/pay/"), `never a pay page (${page.url()})`);
    // the plan is Monster Free on record, from the code on
    const plan = await planOnRecord(http, page);
    expect(
      plan !== null && plan.planId === "free" && plan.status === "free",
      `Monster Free on record (${JSON.stringify(plan)})`,
    );
    // the upgrade is where REQ-054 put it: the settings panel's cards
    await page.goto("/settings");
    await page.locator("[data-cy='plan-card']").waitFor({ timeout: 60_000 });
    await expect.see("Monster Free");
    expect.eq(
      await page.locator("[data-cy='plan-pick-monster']").count(),
      1,
      "the paid plans are there to upgrade to",
    );
    expect.eq(
      await page.locator("[data-cy='plan-pick-assist']").count(),
      1,
      "both of them",
    );
  }));

/**
 * REQ-113 — Raphael, 2026-10-21, the launch checklist: "Carry the selected plan from the
 * landing-page button into signup so customers enter the correct flow." — and, told the $99 pick
 * was asked again at the wizard's fourth step: "can we get #2 implemented?" The $99 card's Sign
 * up names Monster with the code; the account carries the name from then on (the CRM's Signup
 * Plan, the team's notice), and the moment the wizard has the email a paid pick needs the pick is
 * made: the plan step shows Monster with the way to its payment page — never the cards — and
 * paying there brings the person back with Monster active, the wizard moving on to the state.
 */
Deno.test("REQ-113: Sign up on the $99 card carries Monster into the wizard — the CRM reads Monster from the code on; after the name, the business and the email the plan step is Monster's payment page, no cards; paid there, the wizard goes on to the state with Monster active", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await expect.see("Get started in 30 seconds");
    await enterThrough(page, "monster");
    await signUpOnCard(page);
    await carrySession(page, baseUrl);
    await expect.see("what should we call you");
    expect.eq(
      await stepCount(page),
      "10",
      "ten steps: the plan is one of them — where the payment page is",
    );
    const headers = await sessionHeaders(page);
    // the name is on the account from the code on; the pick waits for the email a paid pick needs
    const me = await (await http("/api/me", { headers })).json();
    expect.eq(me.signupPlan, "monster", "the account carries the plan the button named");
    expect(
      await planOnRecord(http, page) === null,
      "no pick before the email",
    );
    // … and the CRM reads it, in its own lane (REQ-111): the team knows what was asked for before
    // a single answer
    const readCrm = async () => {
      const text = await (await http("/api/me/crm-customer", { headers })).text();
      return text ? JSON.parse(text) : null;
    };
    let crm = await readCrm();
    for (let i = 0; i < 80 && crm?.signupPlan !== "Monster"; i++) {
      await page.waitForTimeout(250);
      crm = await readCrm();
    }
    expect.eq(crm?.signupPlan, "Monster", "the CRM's Signup Plan is Monster from the sign-up on");
    expect.eq(crm?.tier, "Lead", "a Lead until the first month is paid");
    await fillStep(page, "input.welcome__input", "Carried Story");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("business called");
    await page.locator("[data-cy='welcome-skip']").click();
    await expect.see("best email");
    await fillStep(
      page,
      "input[type='email']",
      `carried-${digits()}@blackhole.postmarkapp.com`,
    );
    await page.locator("[data-cy='welcome-continue']").click();
    // the plan step is Monster's: the pick was made by the email; the page comes by the sweep (REQ-106)
    await expect.see("Your plan");
    await expect.see("Step 4 of 10");
    await page.locator("[data-cy='plan-pay-link']").waitFor({ timeout: 60_000 });
    expect.eq(
      await page.locator("[data-cy='plan-pending'] b").textContent(),
      "Monster",
      "the plan the button named",
    );
    await expect.see("Continue to payment");
    expect.eq(
      await page.locator("[data-cy^='plan-pick-']").count(),
      0,
      "no cards: the plan was picked on the landing page",
    );
    const pending = await planOnRecord(http, page);
    expect(
      pending?.planId === "monster" && pending?.status === "pending" &&
        pending?.merchant === "primary",
      `Monster, pending through primary (${JSON.stringify(pending)})`,
    );
    // the payment page is Monster's, the wizard its way back
    await page.locator("[data-cy='plan-pay-link']").click();
    await page.waitForURL(
      (u: URL) =>
        u.pathname === "/pay/fake" && u.searchParams.has("customer") &&
        u.searchParams.has("due"),
      { timeout: 60_000 },
    );
    const payPage = new URL(page.url());
    const back = payPage.searchParams.get("return") ?? "";
    expect(
      back.includes("/plan/return?due=") && back.includes("back=%2Fwelcome"),
      `the link carries the way back to the wizard (${back})`,
    );
    await expect.see("Test pay page");
    await page.locator("[data-cy='fake-pay']").click();
    await expect.see("Paid.");
    await page.locator("[data-cy='fake-pay-back']").click();
    await page.waitForURL((u: URL) => u.pathname === "/welcome", {
      timeout: 60_000,
    });
    await expect.see("Which state");
    const plan = await planOnRecord(http, page);
    expect(
      plan?.planId === "monster" && plan?.status === "active",
      `Monster · active (${JSON.stringify(plan)})`,
    );
  }));

/**
 * REQ-107 — Raphael, 2026-10-20, on the shipped /landing2: "if you click start on the $99 it jumps
 * you to start free even though you ask, just change the text to get started." The $99 card's
 * Sign up opened the signup card titled Start free in 30 seconds with a Start free button; the
 * card's title, its button and its consent line say Get started / Empezar now, in both languages,
 * and the card still signs up for the plan whose button brought the person to it (REQ-104).
 */
Deno.test("REQ-107: Sign up on the $99 card opens the signup card saying Get started — not Start free — and the card still signs up for Monster", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await expect.see("Get started in 30 seconds");
    await enterThrough(page, "monster");
    const card = page.locator("[data-cy='l2-signup']");
    expect.eq(await card.getAttribute("data-plan"), "monster", "the card signs up for the plan whose button was pressed");
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
    expect.eq(await card.getAttribute("data-plan"), "monster", "still Monster");
    // the buttons INTO the card keep their own words: the Monster Free card starts free, the paid cards sign up
    expect.eq(((await page.locator("[data-cy='l2-plan-cta'][data-plan='free']").textContent()) ?? "").trim(), "Empezar gratis", "the Monster Free card's button still says Empezar gratis");
    expect.eq(((await page.locator("[data-cy='l2-plan-cta'][data-plan='monster']").textContent()) ?? "").trim(), "Registrarme", "the $99 card's button says Registrarme");
  }));

/**
 * REQ-111 — Raphael, 2026-10-21, the launch checklist: "CRITICAL — Save incomplete signups. For
 * Monster Free, Monster, and Monster Assist, save any and all information collected, even if the
 * customer does not complete signup. Capture contact information as early as possible so we can
 * call and help them finish. Include their selected plan and the exact stage they reached so the
 * team knows how to follow up. Make these incomplete signups accessible to the team."
 * The CRM customer the sign-up made (REQ-058) carries, after every save, the selected plan and the
 * exact stage; a Monster Free signup sits on the CRM ladder's Free rung. The fake CRM echoes what
 * it was told; the real one shows the two beside the lead once it holds the columns (its own REQ).
 */
Deno.test("REQ-111: a Monster Free signup that stops after three questions is on the CRM with its plan, its stage — 4 of 9 answered, next the state — and everything typed so far", (t) =>
  story(t, async ({ page, expect, http }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await enterThrough(page, "free");
    await signUpOnCard(page);
    await expect.see("what should we call you");
    await fillStep(page, "input.welcome__input", "Stage Story");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("business called");
    await fillStep(page, "input.welcome__input", "Stage Story Roofing");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("best email");
    await fillStep(page, "input[type='email']", `stage-${digits()}@blackhole.postmarkapp.com`);
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("Which state");
    // … and the person leaves. The CRM already has them, with the plan and the stage: the sync rides
    // the outbox after each reply (REQ-098/099), so the record is read until it says so — up to
    // 20 s, in its own lane whatever the other stories' accounts are doing on the CRM (REQ-111)
    const headers = await sessionHeaders(page);
    const read = async () => {
      const text = await (await http("/api/me/crm-customer", { headers })).text();
      return text ? JSON.parse(text) : null;
    };
    let crm = await read();
    for (let i = 0; i < 80 && !(crm && crm.signupStage === "4 of 9 answered — next the state"); i++) {
      await page.waitForTimeout(250);
      crm = await read();
    }
    expect(crm !== null, "the CRM knows the account");
    expect.eq(crm.signupPlan, "Monster Free", "the selected plan is on the record");
    expect.eq(crm.signupStage, "4 of 9 answered — next the state", "the exact stage reached");
    expect.eq(crm.tier, "Free", "on the CRM ladder's Free rung");
    expect.eq(crm.customerName, "Stage Story Roofing", "the business typed so far");
    expect.eq(crm.contact, "Stage Story", "the person typed so far");
    expect(typeof crm.customerEmail === "string" && crm.customerEmail.startsWith("stage-"), `the email typed so far (${crm.customerEmail})`);
  }));
