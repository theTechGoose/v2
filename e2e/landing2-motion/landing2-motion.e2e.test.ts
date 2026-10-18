/**
 * REQ-083 — Raphael, 2026-10-18, on the /landing2 signup card: "what kind of sexy ass animations
 * can we add to this to make it stand out? really something that goes WOW this is incredible. do it."
 *
 * The card tells the signup in motion, phone to app: it slams in and the stripe bar wipes in; the
 * monster leans toward the card when the phone field is focused and turns to follow the cursor;
 * each digit pops in and the button charges at ten; "Get started" launches a text bubble, the
 * monster bounces and the card flips to the code step; the code is six slots that the digits pop
 * into — from the keyboard, the phone's autofill or the dev popup, which types itself in — and the
 * sixth digit submits; a wrong code shakes; the right one draws a check, bursts confetti and lifts
 * the card off into the app. Reduced motion turns all of it off and the flow is the plain one.
 */
import { story, type StoryTools } from "#shots";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };

const anim = (page: StoryTools["page"], sel: string) =>
  page.locator(sel).first().evaluate((el: HTMLElement) =>
    getComputedStyle(el).animationName
  );

Deno.test("REQ-083: the signup card tells the signup in motion — the card slams in, the monster leans in and follows the cursor, the digits pop and the button charges, the text launches and the card flips, the code types itself into the slots, and the check, the confetti and the takeoff carry the person into the app; reduced motion turns it all off", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    const card = "[data-cy='l2-signup']";
    const monster = "[data-cy='l2-monster']";
    // the entrance: the card slams in, its shadow lands, the stripe bar wipes in
    expect(
      (await anim(page, card)).includes("l2-slam"),
      `the card slams in (${await anim(page, card)})`,
    );
    expect(
      (await anim(page, card)).includes("l2-shadow-land"),
      "and its shadow lands a beat later",
    );
    expect.eq(
      await anim(page, ".l2-bunting"),
      "l2-stripe-in",
      "the stripe bar wipes in",
    );
    // the monster leans in when the phone field is focused, and follows the cursor
    // (the islands may still be hydrating: focus until the monster answers)
    for (let i = 0; i < 20; i++) {
      await page.locator("#reg-phone").focus();
      await page.waitForTimeout(150);
      if (await page.locator(`${monster}.l2-monster--lean`).count()) break;
      await page.locator("body").click({ position: { x: 5, y: 5 } });
    }
    expect.eq(
      await page.locator(`${monster}.l2-monster--lean`).count(),
      1,
      "the monster leans toward the card when the phone field is focused",
    );
    await page.mouse.move(200, 400);
    await page.waitForTimeout(80);
    const left = await page.locator(monster).evaluate((el: HTMLElement) =>
      el.style.getPropertyValue("--l2-ty")
    );
    await page.mouse.move(1100, 400);
    await page.waitForTimeout(80);
    const right = await page.locator(monster).evaluate((el: HTMLElement) =>
      el.style.getPropertyValue("--l2-ty")
    );
    expect(
      left !== "" && right !== "" && left !== right,
      `the monster turns with the cursor (${left} → ${right})`,
    );
    expect(
      parseFloat(left) < 0 && parseFloat(right) > 0,
      `it turns toward the cursor (${left} / ${right})`,
    );
    // each digit pops in; at ten the field is done and the button is charged
    const phone = `512${digits()}`;
    await page.locator("#reg-phone").pressSequentially(phone, { delay: 15 });
    expect.eq(
      await page.locator(`${card} .l2-phone__d`).count(),
      10,
      "ten digits shown",
    );
    expect.eq(
      await anim(page, `${card} .l2-phone__d:last-child`),
      "l2-digit-in",
      "the last digit popped in",
    );
    expect.eq(
      await page.locator(`${card} .l2-phone--done`).count(),
      1,
      "the field is done",
    );
    expect.eq(
      await page.locator(`${card} .l2-btn--charged`).count(),
      1,
      "the button is charged",
    );
    expect.eq(
      await anim(page, `${card} .l2-btn--charged`),
      "l2-charge",
      "and pulses once",
    );
    // Get started: the text bubble launches, the monster bounces, the card flips to the code step
    await page.locator("[data-cy='l2-send-code']").click();
    await page.locator("[data-cy='l2-sms']").waitFor({
      state: "visible",
      timeout: 5000,
    });
    expect.eq(
      await anim(page, "[data-cy='l2-sms']"),
      "l2-sms-fly",
      "the text bubble flies",
    );
    await page.locator("[data-cy='l2-signup-step'][data-step='2']").waitFor({
      timeout: 15_000,
    });
    await page.locator(`${card}[data-motion='flipped']`).waitFor({
      timeout: 5000,
    });
    expect.eq(
      await page.locator(card).getAttribute("data-motion"),
      "flipped",
      "the card flipped to the code step",
    );
    await page.locator(`${monster}[data-motion='bounced']`).waitFor({
      timeout: 5000,
    });
    expect.eq(
      await page.locator(monster).getAttribute("data-motion"),
      "bounced",
      "the monster bounced",
    );
    expect.eq(
      await page.locator("[data-cy='l2-code-slot']").count(),
      6,
      "six code slots",
    );
    // the digits pop into the slots; a wrong sixth digit submits by itself and shakes
    await page.locator("#reg-code").pressSequentially("111", { delay: 30 });
    expect.eq(
      await page.locator(`${card} .l2-code__d`).count(),
      3,
      "three digits in the slots",
    );
    expect.eq(
      await anim(page, `${card} .l2-code__d`),
      "l2-slot-in",
      "they popped in",
    );
    await page.locator("#reg-code").pressSequentially("111", { delay: 30 });
    await page.locator(`${card} .l2-code--bad`).waitFor({ timeout: 10_000 });
    expect.eq(
      await anim(page, `${card} .l2-code--bad`),
      "l2-shake",
      "a wrong code shakes — with no button pressed",
    );
    await expect.see("That code is not right");
    // the dev popup's code types itself in, the sixth digit submits, and the takeoff carries the person into the app
    const popup = page.locator("[data-cy='dev-code']");
    await popup.waitFor({ state: "visible", timeout: 10_000 });
    const code =
      (await popup.locator("[data-cy='dev-code-value']").textContent() ?? "")
        .trim();
    await page.locator("[data-cy='dev-code-use']").click();
    await page.waitForFunction(
      (n: number) =>
        ((document.querySelector("#reg-code") as HTMLInputElement | null)?.value
          .length ?? 0) >= n,
      2,
      { timeout: 5000 },
    );
    const partial = await page.locator("#reg-code").inputValue();
    expect(
      partial.length >= 2 && partial.length < 6 && code.startsWith(partial),
      `the code is typing itself, digit by digit (${partial} of ${code})`,
    );
    await page.locator("[data-cy='l2-takeoff']").waitFor({
      state: "attached",
      timeout: 15_000,
    });
    // one read: the redirect is 800 ms away
    const takeoff = await page.evaluate(() => {
      const a = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el ? getComputedStyle(el).animationName : "missing";
      };
      return {
        fade: a("[data-cy='l2-takeoff']"),
        check: a("[data-cy='l2-signup'] .l2-check path"),
        confetti:
          document.querySelectorAll("[data-cy='l2-signup'] .l2-confetti i")
            .length,
        card: a("[data-cy='l2-signup']"),
      };
    });
    expect.eq(takeoff.fade, "l2-fade-in", "the page fades toward the app");
    expect.eq(takeoff.check, "l2-draw", "the check draws itself");
    expect(takeoff.confetti >= 12, `the confetti bursts (${takeoff.confetti})`);
    expect(
      takeoff.card.includes("l2-takeoff"),
      `the card lifts off (${takeoff.card})`,
    );
    await page.waitForURL((u: URL) => u.pathname !== "/landing2", {
      timeout: 60_000,
    });
    expect(!page.url().includes("/login"), `into the app (${page.url()})`);
    await page.context().clearCookies();

    // reduced motion: nothing moves, and the flow is the plain one
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/landing2?lang=en");
    expect.eq(
      await anim(page, card),
      "none",
      "no entrance under reduced motion",
    );
    expect.eq(await anim(page, ".l2-bunting"), "none", "no stripe wipe");
    await page.locator("#reg-phone").focus();
    await page.mouse.move(300, 400);
    await page.waitForTimeout(80);
    expect.eq(
      await page.locator(monster).evaluate((el: HTMLElement) =>
        el.className.includes("l2-monster--lean") ||
        el.style.getPropertyValue("--l2-ty") !== ""
      ),
      false,
      "the monster stays still",
    );
    await page.locator("#reg-phone").fill(`512${digits()}`);
    await page.locator("[data-cy='l2-send-code']").click();
    await page.locator("[data-cy='l2-signup-step'][data-step='2']").waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='l2-sms']").count(),
      0,
      "no text bubble",
    );
    expect.eq(
      await page.locator(card).getAttribute("data-motion"),
      null,
      "no flip",
    );
    await page.locator("[data-cy='dev-code']").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.locator("[data-cy='dev-code-use']").click();
    await page.waitForURL((u: URL) => u.pathname !== "/landing2", {
      timeout: 60_000,
    });
    expect.eq(
      await page.locator("[data-cy='l2-takeoff']").count(),
      0,
      "no takeoff: straight into the app",
    );
  }));
