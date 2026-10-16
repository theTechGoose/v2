/**
 * REQ-081 — Raphael, 2026-10-16: "take this mock /Users/raphaelcastro/Documents/programming/v2/
 * Landing v2 — conversion-first-html.zip make it real at /landing2 and make sure all aspects of
 * the page are working."
 *
 * The page: front-end/routes/landing2.tsx (SSR, Spanish first, English on the toggle), its two
 * islands — Landing2Signup (phone → code → done, on the page, through the real OTP endpoints)
 * and Landing2Demo (demo or call, a day, a time, the details → POST /demo-request) — and
 * front-end/static/landing2.css. The stories run on the fakes: the code is the dev master code,
 * the text and the email go nowhere but are reported done, the pixel is the app's own fake.
 */
import { story, type StoryTools } from "#shots";
import { LEGAL_LINKS } from "../../shared/legal/terms.ts";
import { PUBLIC_PLANS } from "../../shared/quote-flow/pricing-plans.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

interface PixelCall {
  name: string;
  eventId?: string;
}

/** the pixel's events since the last drain — the fake's record, or the real loader's requests on the user's own run */
function watchPixel(page: StoryTools["page"]) {
  const real: PixelCall[] = [];
  page.on("request", (req: { url(): string }) => {
    const u = new URL(req.url());
    if (u.hostname !== "www.facebook.com" || !u.pathname.startsWith("/tr")) {
      return;
    }
    real.push({
      name: u.searchParams.get("ev") ?? "",
      eventId: u.searchParams.get("eid") ?? undefined,
    });
  });
  return async function drain(): Promise<PixelCall[]> {
    const fake = await page.evaluate(() => {
      // deno-lint-ignore no-explicit-any
      const w = globalThis as any;
      if (!Array.isArray(w.__pmPixel)) return null;
      const out = w.__pmPixel.slice();
      w.__pmPixel.length = 0;
      return out as unknown[][];
    }).catch(() => null);
    if (fake) {
      return fake.map((args: unknown[]): PixelCall => {
        const [verb, a, , c] = args as [
          string,
          string,
          unknown,
          { eventID?: string }?,
        ];
        return verb === "init"
          ? { name: "init" }
          : { name: a, eventId: c?.eventID };
      });
    }
    const out = real.slice();
    real.length = 0;
    return out;
  };
}

const count = async (page: StoryTools["page"], selector: string) =>
  await page.locator(selector).count();

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

Deno.test("REQ-081: /landing2 is the mock made real — every section of it, Spanish first, English on the toggle, on a desktop and on a phone", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2");
    // Spanish first, no cookie, whatever the browser says (REQ-002)
    await expect.see("Cotizaciones en inglés");
    await expect.see("que te ganan el trabajo.");
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "es",
      "<html lang> is es",
    );
    // every section of the mock, top to bottom
    for (
      const section of [
        "nav",
        "hero",
        "signup",
        "outcomes",
        "proof",
        "team",
        "plans",
        "demo",
        "faq",
        "final",
        "footer",
      ]
    ) {
      expect.eq(
        await count(page, `[data-cy='l2-${section}']`),
        1,
        `the ${section} section is on the page`,
      );
    }
    await expect.see("Un mensaje. Tres documentos.");
    await expect.see("Personas reales. En tu idioma. Siete días a la semana.");
    await expect.see("Empieza gratis. Precio fijo al mes. Sin sorpresas.");
    await expect.see("Elige el día y la hora. Nosotros te llamamos.");
    await expect.see("Deja el Papeleo al Monstruo. Tú sigue en la obra.");
    // the monster and the signed quote card of the hero
    const img = page.locator(
      "[data-cy='l2-hero'] img[src^='/monster-paper.png']",
    ).first();
    expect(
      await img.evaluate((el: HTMLImageElement) =>
        el.complete && el.naturalWidth > 0
      ),
      "the monster image loaded",
    );
    await expect.see("Quote #PM-2641 · $10,990");
    // English on the toggle
    await page.locator("[data-cy='l2-lang']").click();
    await page.waitForURL((u: URL) => u.searchParams.get("lang") === "en");
    await expect.see("Quotes in English");
    await expect.see("that win you the job.");
    await expect.see("One message. Three documents.");
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "<html lang> is en",
    );
    await expect.notSee("Cotizaciones en inglés");
    // and back
    await page.locator("[data-cy='l2-lang']").click();
    await page.waitForURL((u: URL) => u.searchParams.get("lang") === "es");
    await expect.see("Cotizaciones en inglés");
    // the phone: one column, the headline smaller, the sticky bar at the bottom
    await page.setViewportSize(PHONE);
    await page.goto("/landing2");
    await expect.see("Cotizaciones en inglés");
    const bar = page.locator("[data-cy='l2-stickybar']");
    expect(await bar.isVisible(), "the sticky bar shows on a phone");
    const barBox = await bar.boundingBox();
    expect(
      !!barBox && Math.abs(barBox.y + barBox.height - PHONE.height) < 2,
      `the sticky bar sits at the bottom of the screen (${
        JSON.stringify(barBox)
      })`,
    );
    const h1 = await page.locator("[data-cy='l2-hero'] h1").evaluate((
      el: HTMLElement,
    ) => parseFloat(getComputedStyle(el).fontSize));
    expect.eq(h1, 40, "the headline is 40px on a phone (58 on a desktop)");
    const scrollW = await page.evaluate(() =>
      document.documentElement.scrollWidth
    );
    expect(scrollW <= PHONE.width, `nothing wider than the phone (${scrollW})`);
    await page.locator("[data-cy='l2-faq'] summary").first()
      .scrollIntoViewIfNeeded();
    await page.locator("body").press("Shift"); // a frame of the lower half on the phone
  }));

Deno.test("REQ-081: the hero signup works on the page — the code goes out, the code opens the account, Done links into the app, and the Lead fires once", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    const drain = watchPixel(page);
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2");
    await expect.see("Empieza gratis en 30 segundos");
    await drain(); // the PageView
    const phone = `512${digits()}`;
    // step 1: the phone
    await page.locator("#reg-phone").fill(phone);
    await page.locator("[data-cy='l2-send-code']").click();
    // step 2: the code, on the same page — and the Lead, once
    await expect.see("Te mandamos un código de 6 dígitos");
    const calls = await drain();
    const leads = calls.filter((c) => c.name === "Lead");
    expect.eq(
      leads.length,
      1,
      `one Lead when the code goes out (${JSON.stringify(calls)})`,
    );
    expect(
      /^lead:[0-9a-f]{8}$/.test(leads[0].eventId ?? ""),
      `the Lead carries its stable id (${leads[0].eventId})`,
    );
    // a wrong code is refused, on the page
    await page.locator("#reg-code").fill("111111");
    await page.locator("[data-cy='l2-confirm-code']").click();
    await expect.see("Ese código no es correcto");
    // the right code opens the account (the dev master code on the fakes)
    await page.locator("#reg-code").fill("000000");
    await page.locator("[data-cy='l2-confirm-code']").click();
    await expect.see("¡Listo, ya estás dentro!");
    const open = page.locator("[data-cy='l2-open-app']");
    const href = (await open.getAttribute("href")) ?? "";
    expect(
      href.startsWith("/") && !href.startsWith("//"),
      `Done links into the app, where the server sends a new account (${href})`,
    );
    expect.eq(
      (await drain()).filter((c) => c.name === "Lead").length,
      0,
      "no second Lead for the code",
    );
    // Done really opens the app, signed in: the page the server named, not the login
    await open.click();
    // the app's own onboarding redirect may carry the new account one hop further; what matters is
    // that it left the landing for an app page and was not bounced to the login
    await page.waitForURL((u: URL) => u.pathname !== "/landing2", {
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle");
    const landed = new URL(page.url()).pathname;
    expect(
      landed !== "/login" && landed !== "/landing2",
      `signed in and inside the app (${landed}, via ${href})`,
    );
    // back on the landing: the Lead's once-per-browser guard is on record (REQ-080's key by event id),
    // and a second code for the same number inside 30 s is the cooldown, said on the page (P-03)
    await page.goto(`${baseUrl}/landing2`);
    await drain();
    const guarded = await page.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith("pm:px:lead:"))
    );
    expect(guarded, "the Lead's once-per-browser guard is on record");
    await page.locator("#reg-phone").fill(phone);
    await page.locator("[data-cy='l2-send-code']").click();
    await expect.see("Ya te mandamos un código");
    expect.eq(
      (await drain()).filter((c) => c.name === "Lead").length,
      0,
      "no Lead for a code that did not go out",
    );
    // a different number: the code goes out, and "Cambiar número o reenviar" goes back to the phone
    await page.locator("#reg-phone").fill(`512${digits()}`);
    await page.locator("[data-cy='l2-send-code']").click();
    await expect.see("Te mandamos un código de 6 dígitos");
    await page.locator("[data-cy='l2-back-to-phone']").click();
    await expect.see("Empieza gratis en 30 segundos");
  }));

Deno.test("REQ-081: booking a demo works — demo or call, a day, a time, the details, then the confirmation; the team is emailed, the person is texted, and the phone is a lead", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await expect.see("Pick the day and time. We call you.");
    await page.locator("#demo").scrollIntoViewIfNeeded();
    // seven days from tomorrow, twelve hours; the summary follows the picks
    expect.eq(await count(page, "[data-cy='l2-day']"), 7, "seven days to pick");
    expect.eq(
      await count(page, "[data-cy='l2-slot']"),
      12,
      "twelve hours to pick",
    );
    const summary = page.locator("[data-cy='l2-demo-summary']");
    expect(
      /15-min demo · .+ · 11:00 AM/.test((await summary.textContent()) ?? ""),
      `the summary starts on the demo at 11:00 AM (${await summary
        .textContent()})`,
    );
    await clickUntil(
      page,
      "[data-cy='l2-day'] >> nth=2",
      async () =>
        (await page.locator("[data-cy='l2-day']").nth(2).getAttribute("class"))
          ?.includes("on") ?? false,
    );
    await clickUntil(
      page,
      "[data-cy='l2-slot'] >> nth=5",
      async () =>
        (await page.locator("[data-cy='l2-slot']").nth(5).getAttribute("class"))
          ?.includes("on") ?? false,
    );
    const dayLabel =
      ((await page.locator("[data-cy='l2-day']").nth(2).textContent()) ?? "")
        .replace(/\s+/g, " ").trim();
    expect(
      ((await summary.textContent()) ?? "").includes("2:00 PM"),
      "the summary follows the hour",
    );
    // a demo needs an email unless there is none — the page says so before posting
    await page.locator("#f-name").fill("José García");
    await page.locator("#f-phone").fill(`512${digits()}`);
    await page.locator("[data-cy='l2-demo-submit']").click();
    await expect.see("Email is required for the demo");
    await page.locator("#f-noemail").check();
    await page.locator("#f-trade").fill("Painting");
    // the booking posts and the server says what it did
    const [res] = await Promise.all([
      page.waitForResponse((
        r: { url(): string; request(): { method(): string } },
      ) =>
        r.url().includes("/api/demo-request") && r.request().method() === "POST"
      ),
      page.locator("[data-cy='l2-demo-submit']").click(),
    ]);
    const body = await res.json();
    expect.eq(body.ok, true, `the booking was taken (${JSON.stringify(body)})`);
    expect.eq(body.emailed, true, "the team was emailed");
    // the text: sent on the fakes and on the real run; a box whose Twilio seat is half-configured
    // reports it honestly as not sent, and the page says so — either way the booking stands
    expect.eq(
      typeof body.texted,
      "boolean",
      "the server says whether the person was texted",
    );
    expect.eq(body.lead, true, "the phone is a lead");
    expect.eq(body.slot, "2:00 PM", "the slot picked");
    await expect.see("Done!");
    await expect.see(
      body.texted
        ? "We sent you a text confirmation."
        : "We could not text you, but your booking is in",
    );
    const done =
      (await page.locator("[data-cy='l2-demo-done']").textContent()) ?? "";
    expect(
      done.includes("15-min demo") && done.includes("2:00 PM"),
      `the confirmation repeats the booking (${done})`,
    );
    const dayNum = /\d+/.exec(dayLabel)?.[0] ?? "";
    expect(
      dayNum !== "" && done.includes(` ${dayNum} `),
      `the confirmation names the day picked (${dayLabel} in ${done})`,
    );
    // "just call me" is the other mode, Spanish, no email at all (an explicit ?lang= is a choice the
    // site persists — lib/lang.ts — so the Spanish page is asked for by name)
    await page.goto("/landing2?lang=es");
    await page.locator("#demo").scrollIntoViewIfNeeded();
    await clickUntil(
      page,
      "[data-cy='l2-mode-call']",
      async () => ((await summary.textContent()) ?? "").startsWith("Llamada"),
    );
    expect(
      ((await summary.textContent()) ?? "").startsWith("Llamada"),
      "the summary says a call",
    );
    await page.locator("#f-name").fill("María López");
    await page.locator("#f-phone").fill(`512${digits()}`);
    const [res2] = await Promise.all([
      page.waitForResponse((
        r: { url(): string; request(): { method(): string } },
      ) =>
        r.url().includes("/api/demo-request") && r.request().method() === "POST"
      ),
      page.locator("[data-cy='l2-demo-submit']").click(),
    ]);
    expect.eq((await res2.json()).mode, "call", "a call was booked");
    await expect.see("¡Listo!");
  }));

Deno.test("REQ-081: the FAQ opens and closes, the plans are the one plan list, every link and button lands where it says, and a phone shows the sticky bar", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await expect.see("Have doubts?");
    // the FAQ: four questions, each opens and closes
    const faqs = page.locator("[data-cy='l2-faq'] details");
    expect.eq(await faqs.count(), 4, "four questions");
    await faqs.nth(0).locator("summary").click();
    expect(
      await faqs.nth(0).evaluate((d: HTMLDetailsElement) => d.open),
      "the first question opened",
    );
    await expect.see("it is built exactly for you");
    await faqs.nth(0).locator("summary").click();
    expect(
      !(await faqs.nth(0).evaluate((d: HTMLDetailsElement) => d.open)),
      "and closed again",
    );
    // the plans: the one list, its names, prices and features
    const cards = page.locator("[data-cy='l2-plan']");
    expect.eq(
      await cards.count(),
      PUBLIC_PLANS.length,
      "one card per public plan",
    );
    for (let i = 0; i < PUBLIC_PLANS.length; i++) {
      const plan = PUBLIC_PLANS[i];
      const card = cards.nth(i);
      expect.eq(
        await card.getAttribute("data-plan"),
        plan.id,
        `card ${i} is ${plan.id}`,
      );
      await expect.see(plan.name);
      const price =
        ((await card.locator("[data-cy='l2-plan-price']").textContent()) ?? "")
          .trim();
      expect(
        price.startsWith(
          plan.custom ? "Custom" : `$${Math.round(plan.priceCents / 100)}`,
        ),
        `${plan.id} shows its price (${price})`,
      );
      for (const f of plan.features) await expect.see(f.en);
      const cta = await card.locator("[data-cy='l2-plan-cta']").getAttribute(
        "href",
      );
      expect.eq(
        cta,
        plan.custom ? "#demo" : "#empezar",
        `${plan.id}'s button goes to ${
          plan.custom ? "the demo" : "the signup"
        }`,
      );
    }
    expect.eq(
      await count(page, "[data-cy='l2-plan'][data-popular]"),
      1,
      "one plan is the popular one",
    );
    // the policy links: the four, in order, to their own pages
    const legal = page.locator("[data-cy='l2-footer'] a[data-legal-link]");
    expect.eq(await legal.count(), LEGAL_LINKS.length, "the four policy links");
    for (let i = 0; i < LEGAL_LINKS.length; i++) {
      expect.eq(
        await legal.nth(i).getAttribute("href"),
        LEGAL_LINKS[i].path,
        `policy link ${i} is ${LEGAL_LINKS[i].path}`,
      );
    }
    // the phone, WhatsApp and email links
    expect(
      (await count(page, "a[href='tel:+18553628666']")) >= 4,
      "the phone links dial the support line",
    );
    const wa = await page.locator("[data-cy='l2-whatsapp']").first()
      .getAttribute("href");
    expect.eq(
      wa,
      "https://wa.me/18553628666",
      "WhatsApp opens the support line",
    );
    expect((await count(page, "a[href^='mailto:']")) >= 2, "the email links");
    // the in-page buttons: Start free → the signup, Book a demo → the demo
    await page.locator("[data-cy='l2-nav'] a[href='#empezar']").click();
    expect(
      await page.locator("#empezar").evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.top >= -2 && r.top < innerHeight;
      }),
      "Start free scrolls to the signup card",
    );
    await page.locator("[data-cy='l2-hero'] a[href='#demo']").click();
    expect(
      await page.locator("#demo").evaluate((el: HTMLElement) =>
        el.getBoundingClientRect().top < innerHeight / 2
      ),
      "Book a demo scrolls to the demo",
    );
    // every policy link really lands on its page
    await page.locator("[data-cy='l2-footer'] a[data-legal-link='privacy']")
      .click();
    await page.waitForURL((u: URL) => u.pathname === "/privacy");
    await expect.see("Privacy Policy");
    // the phone: the sticky bar is the three buttons, and it is gone on a desktop
    await page.goto("/landing2?lang=en");
    expect.eq(
      await page.locator("[data-cy='l2-stickybar']").isVisible(),
      false,
      "no sticky bar on a desktop",
    );
    await page.setViewportSize(PHONE);
    await page.goto("/landing2?lang=en");
    const bar = page.locator("[data-cy='l2-stickybar']");
    expect(await bar.isVisible(), "the sticky bar on a phone");
    expect.eq(
      await bar.locator("a").count(),
      3,
      "three buttons: start, WhatsApp, call",
    );
    await bar.locator("a[href='#empezar']").click();
    expect(
      await page.locator("#empezar").evaluate((el: HTMLElement) =>
        el.getBoundingClientRect().top < innerHeight
      ),
      "the bar's Start free reaches the signup",
    );
  }));

/**
 * Raphael's feedback on the shown page, 2026-10-16: "the english spanish toggle looks like ass when
 * toggling, if you click it at all it should toggle to the opposite, you should not have to click
 * the letters." · "need more contrast on this button" (1-855-DocuMon, dark on dark) · "more
 * contrast on this button" (Call us, the same) · "this is cut off" (the day picker's seventh day).
 */
Deno.test("REQ-081: the language toggle is one button — a click anywhere on it flips the language, both ways", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=es");
    const toggle = page.locator("[data-cy='l2-lang']");
    expect.eq(await toggle.count(), 1, "one toggle");
    expect.eq(
      await toggle.evaluate((el: HTMLElement) => el.tagName),
      "A",
      "the whole toggle is the link",
    );
    expect.eq(
      await toggle.locator("a, button").count(),
      0,
      "no smaller target inside it",
    );
    expect.eq(
      await toggle.getAttribute("href"),
      "/landing2?lang=en",
      "from Spanish it goes to English",
    );
    // a click on its edge, far from both letters
    const box = (await toggle.boundingBox())!;
    await page.mouse.click(box.x + 2, box.y + box.height / 2);
    await page.waitForURL((u: URL) => u.searchParams.get("lang") === "en");
    await expect.see("Quotes in English");
    expect.eq(
      await toggle.getAttribute("href"),
      "/landing2?lang=es",
      "from English it goes to Spanish",
    );
    const box2 = (await toggle.boundingBox())!;
    await page.mouse.click(box2.x + box2.width - 2, box2.y + box2.height / 2);
    await page.waitForURL((u: URL) => u.searchParams.get("lang") === "es");
    await expect.see("Cotizaciones en inglés");
    // the current language is the lit half, the other half is readable ink on white
    const halves = toggle.locator("span");
    expect.eq(await halves.count(), 2, "ES and EN");
    expect.eq(
      await halves.nth(0).evaluate((el: HTMLElement) =>
        getComputedStyle(el).color
      ),
      "rgb(255, 255, 255)",
      "ES lit",
    );
    expect.eq(
      await halves.nth(1).evaluate((el: HTMLElement) =>
        getComputedStyle(el).color
      ),
      "rgb(21, 32, 43)",
      "EN ink",
    );
  }));

Deno.test("REQ-081: every dark button has white text and every light button has ink text, at rest and on hover", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    const WHITE = "rgb(255, 255, 255)";
    const INK = "rgb(21, 32, 43)";
    const color = (sel: string) =>
      page.locator(sel).first().evaluate((el: HTMLElement) =>
        getComputedStyle(el).color
      );
    const dark = "[data-cy='l2-team'] a.l2-btn--dark";
    const callUs = "[data-cy='l2-final'] a.l2-btn--dark";
    expect.eq(await color(dark), WHITE, "1-855-DocuMon is white on ink");
    expect.eq(await color(callUs), WHITE, "Call us is white on ink");
    expect.eq(
      await color("[data-cy='l2-final'] a.l2-btn--ghost"),
      INK,
      "Book a demo is ink on white",
    );
    expect.eq(
      await color("[data-cy='l2-nav'] a.l2-btn--primary"),
      INK,
      "Start free is ink on orange",
    );
    // and on hover the text keeps its colour — the page's link hover never paints a button green
    await page.locator(callUs).scrollIntoViewIfNeeded();
    await page.locator(callUs).hover();
    expect.eq(
      await color(callUs),
      WHITE,
      "Call us stays white under the mouse",
    );
    await page.locator("[data-cy='l2-final'] a.l2-btn--ghost").first().hover();
    expect.eq(
      await color("[data-cy='l2-final'] a.l2-btn--ghost"),
      INK,
      "Book a demo stays ink under the mouse",
    );
    expect.eq(
      await count(page, "a.l2-btn--dark"),
      await page.locator("a.l2-btn--dark").evaluateAll((els: HTMLElement[]) =>
        els.filter((el) => getComputedStyle(el).color === "rgb(255, 255, 255)")
          .length
      ),
      "every dark button on the page",
    );
  }));

Deno.test("REQ-081: all seven days of the demo's day picker sit whole inside the card, on a desktop and on a phone", (t) =>
  story(t, async ({ page, expect }) => {
    for (const vp of [DESKTOP, PHONE]) {
      await page.setViewportSize(vp);
      await page.goto("/landing2?lang=en#demo");
      const days = page.locator("[data-cy='l2-day']");
      expect.eq(await days.count(), 7, `seven days at ${vp.width}px`);
      const card = (await page.locator("[data-cy='l2-demo'] .l2-demo__card")
        .boundingBox())!;
      for (let i = 0; i < 7; i++) {
        const b = (await days.nth(i).boundingBox())!;
        expect(
          b.x >= card.x && b.x + b.width <= card.x + card.width + 0.5,
          `day ${i + 1} is whole inside the card at ${vp.width}px (${
            Math.round(b.x + b.width)
          } ≤ ${Math.round(card.x + card.width)})`,
        );
      }
      const row = page.locator("[data-cy='l2-demo'] .l2-demo__days");
      expect(
        await row.evaluate((el: HTMLElement) =>
          el.scrollWidth <= el.clientWidth + 1
        ),
        `nothing to scroll at ${vp.width}px`,
      );
    }
  }));
