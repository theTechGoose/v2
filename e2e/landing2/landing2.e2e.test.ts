/**
 * REQ-081 — Raphael, 2026-10-16: "take this mock … make it real at /landing2 and make sure all
 * aspects of the page are working." REQ-088/089/090 — Raphael, 2026-10-18: "this is the newest
 * itteration of landing2 can you update it? /Users/raphaelcastro/Documents/programming/v2/
 * documonster-landing" — the v3 mock, approved Oct 18. REQ-092/093 — Raphael, 2026-10-19, on the
 * shipped page: "the call us button on the bottom is broken it should scroll us to call us, the
 * 1-855 button to call does not pick up the phone app or facetime etc..." and "big jobs plan or
 * bids needs 10px of padding." REQ-094 — Raphael, 2026-10-19, on that worktree: "go through this
 * with a fine tooth comb." — the audit of the whole page, and what it found. REQ-095 — "go through
 * the landing page with a fine tooth comb again. find any issues, fix them" — the second pass.
 * REQ-096 — "run the fine tooth comb again" — the third.
 *
 * The page: front-end/routes/landing2.tsx (SSR, Spanish first, English on the toggle), its
 * islands — Landing2Signup (phone + the TCPA consent box → code → straight into the app, through
 * the real OTP endpoints) and Landing2Demo (Llámenme with just a cell, or a day and a window with
 * the details, each behind its consent box → POST /demo-request) — and front-end/static/landing2.css.
 * The stories run on the fakes: the code is the dev master code, the text and the email go nowhere
 * but are reported done, the pixel is the app's own fake.
 */
import { story, type StoryTools } from "#shots";
import { LEGAL_LINKS } from "../../shared/legal/terms.ts";
import { PUBLIC_PLANS } from "../../shared/quote-flow/pricing-plans.ts";
import { DEMO_DAY_COUNT, DEMO_SLOTS } from "../../shared/demo-booking/mod.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
/** an iPad in portrait: two columns still, the hero's art column squeezed to the disc's width */
const TABLET = { width: 820, height: 1180 };
const INK = "rgb(21, 32, 43)";
const CARD_PLANS = PUBLIC_PLANS.filter((p) => !p.custom);
const LINE_PLANS = PUBLIC_PLANS.filter((p) => p.custom);

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

/** every POST the browser makes to one API path, counted */
function watchPosts(page: StoryTools["page"], path: string) {
  let n = 0;
  page.on("request", (req: { url(): string; method(): string }) => {
    if (req.method() === "POST" && req.url().includes(path)) n++;
  });
  return () => n;
}

const count = async (page: StoryTools["page"], selector: string) =>
  await page.locator(selector).count();

const top = (page: StoryTools["page"], selector: string) =>
  page.locator(selector).evaluate((el: HTMLElement) =>
    el.getBoundingClientRect().top + globalThis.scrollY
  );

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

const loaded = (page: StoryTools["page"], selector: string) =>
  page.locator(selector).first().evaluate((el: HTMLImageElement) =>
    el.complete && el.naturalWidth > 0
  );

Deno.test("REQ-088: /landing2 is the v3 mock top to bottom — Spanish first, English on the toggle, on a desktop and on a phone", (t) =>
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
    // every section of the mock, in its order: the proof band now sits right after the hero,
    // the outcomes after it
    const order = [
      "nav",
      "hero",
      "proof",
      "outcomes",
      "team",
      "plans",
      "demo",
      "faq",
      "final",
      "footer",
    ];
    let last = -1;
    for (const section of order) {
      expect.eq(
        await count(page, `[data-cy='l2-${section}']`),
        1,
        `the ${section} section is on the page`,
      );
      const y = await top(page, `[data-cy='l2-${section}']`);
      expect(
        y >= last,
        `${section} comes after the section before it (${y} ≥ ${last})`,
      );
      last = y;
    }
    expect.eq(
      await count(page, "[data-cy='l2-signup']"),
      1,
      "the signup card is in the hero",
    );
    // the proof band is ink
    expect.eq(
      await page.locator("[data-cy='l2-proof']").evaluate((el: HTMLElement) =>
        getComputedStyle(el).backgroundColor
      ),
      INK,
      "the proof section is an ink band",
    );
    await expect.see("Un mensaje. Tres documentos.");
    await expect.see("Ganas más trabajos");
    await expect.see("Recuperas tus noches con la familia");
    await expect.see(
      "Personas reales que hablan español. Siete días a la semana.",
    );
    await expect.see("8 AM – 8 PM");
    await expect.see(
      "Empieza gratis o elige un plan con precio fijo al mes. Sin Contratos. Sin Sorpresas.",
    );
    await expect.see(
      "Una factura perdida te cuesta más que un año de DocuMonster.",
    );
    await expect.see("¿Quieres verlo primero? Te llamamos.");
    await expect.see("¿Todavía tienes dudas? DocuMonster no.");
    await expect.see("Deja el Papeleo al Monstruo. Tú sigue en la obra.");
    // the monster, the signed quote card of the hero, Art and Ben
    expect(
      await loaded(page, "[data-cy='l2-hero'] img[src^='/monster-paper.png']"),
      "the monster image loaded",
    );
    await expect.see("Quote #PM-2641 · $10,990");
    expect(
      await loaded(page, "[data-cy='l2-team'] img[src^='/team-art.jpg']"),
      "Art's photo loaded",
    );
    expect(
      await loaded(page, "[data-cy='l2-team'] img[src^='/team-ben.jpg']"),
      "Ben's photo loaded",
    );
    await expect.see("Monster Success Specialist");
    // English on the toggle
    await page.locator("[data-cy='l2-lang']").click();
    await page.waitForURL((u: URL) => u.searchParams.get("lang") === "en");
    await expect.see("Quotes in English");
    await expect.see("that win you the job.");
    await expect.see("One message. Three documents.");
    await expect.see("You win more jobs");
    await expect.see("Real people speaking Spanish. Seven days a week.");
    await expect.see("Want to see it first? We’ll call you.");
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
    // the phone: one column, the headline smaller, the two-button sticky bar at the bottom
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
    expect.eq(
      await bar.locator("a").count(),
      2,
      "two buttons on the bar: start and call",
    );
    const h1 = await page.locator("[data-cy='l2-hero'] h1").evaluate((
      el: HTMLElement,
    ) => parseFloat(getComputedStyle(el).fontSize));
    expect.eq(h1, 40, "the headline is 40px on a phone (58 on a desktop)");
    const scrollW = await page.evaluate(() =>
      document.documentElement.scrollWidth
    );
    expect(scrollW <= PHONE.width, `nothing wider than the phone (${scrollW})`);
    await page.locator("[data-cy='l2-plans']").scrollIntoViewIfNeeded();
    await page.locator("body").press("Shift"); // a frame of the plans on the phone
    await page.locator("[data-cy='l2-faq'] summary").first()
      .scrollIntoViewIfNeeded();
    await page.locator("body").press("Shift"); // a frame of the lower half on the phone
  }));

Deno.test("REQ-088: the proof band, the three outcome cards, Art and Ben, the three plan cards and the Projects line, the FAQ's four points, the final CTA and the sticky bar — every link lands where it says, and WhatsApp is nowhere", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await expect.see("Still have doubts? DocuMonster doesn’t.");
    // the proof band: the four bubbles and the signed quote
    const proof = page.locator("[data-cy='l2-proof']");
    expect.eq(
      await proof.locator(".l2-bubble").count(),
      4,
      "four chat bubbles",
    );
    await expect.see("QUOTE #PM-2641");
    await expect.see("$10,990.00");
    // the outcomes: three headline cards — a number and a title, nothing more
    const outcomes = page.locator("[data-cy='l2-outcome']");
    expect.eq(await outcomes.count(), 3, "three outcome cards");
    const titles = [
      "You win more jobs",
      "You get paid faster",
      "You get your evenings with family back",
    ];
    for (let i = 0; i < 3; i++) {
      const text = ((await outcomes.nth(i).textContent()) ?? "").replace(
        /\s+/g,
        " ",
      ).trim();
      expect.eq(
        text.replace(/^0(\d)\s*/, "0$1 "),
        `0${i + 1} ${titles[i]}`,
        `outcome card ${i + 1} is its number and its headline`,
      );
    }
    // the team: Art and Ben, one dark phone button, the hours
    const members = page.locator("[data-cy='l2-member']");
    expect.eq(await members.count(), 2, "two people");
    expect.eq(
      await members.nth(0).locator("img").getAttribute("alt"),
      "Art",
      "Art's photo",
    );
    expect.eq(
      await members.nth(1).locator("img").getAttribute("alt"),
      "Ben",
      "Ben's photo",
    );
    await expect.see("Monday to Sunday, 8 AM – 8 PM");
    expect.eq(
      await count(page, "[data-cy='l2-team'] a.l2-btn--dark"),
      1,
      "the one phone button of the team",
    );
    // the plans: three cards from the one list — names, prices, features — and the Projects line
    const cards = page.locator("[data-cy='l2-plan']");
    expect.eq(
      await cards.count(),
      CARD_PLANS.length,
      "one card per priced plan",
    );
    for (let i = 0; i < CARD_PLANS.length; i++) {
      const plan = CARD_PLANS[i];
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
        price.startsWith(`$${Math.round(plan.priceCents / 100)}`),
        `${plan.id} shows its price (${price})`,
      );
      for (const f of plan.features) await expect.see(f.en);
      expect.eq(
        await card.locator("[data-cy='l2-plan-cta']").getAttribute("href"),
        "#empezar",
        `${plan.id}'s button goes to the signup`,
      );
    }
    expect.eq(
      await count(page, "[data-cy='l2-plan'][data-popular]"),
      1,
      "one plan is the popular one",
    );
    const line = page.locator("[data-cy='l2-projects']");
    expect.eq(await line.count(), 1, "the Projects line");
    for (const p of LINE_PLANS) {
      expect(
        ((await line.textContent()) ?? "").includes(p.name),
        `the line names ${p.name}`,
      );
    }
    expect.eq(
      await line.locator("a[href='tel:+18553628666']").count(),
      1,
      "the line says call us",
    );
    // the FAQ: four points, four questions that open and close
    expect.eq(
      await count(page, "[data-cy='l2-faq-point']"),
      4,
      "four points beside the questions",
    );
    await expect.see(
      "It sends your quote before your competitor finishes lunch.",
    );
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
    // the final CTA: start, call, demo — three buttons, nothing else
    const final = page.locator("[data-cy='l2-final']");
    expect.eq(
      await final.locator("a").count(),
      3,
      "three buttons in the final CTA",
    );
    expect.eq(
      await final.locator("a[href='#empezar']").count(),
      1,
      "Start free",
    );
    expect.eq(
      await final.locator("a[href='#llamanos']").count(),
      1,
      "Call us — to the call-us section (REQ-092)",
    );
    expect.eq(await final.locator("a[href='#demo']").count(), 1, "Book a demo");
    // WhatsApp is nowhere: no link, no button, no word
    expect.eq(
      await count(page, "a[href*='wa.me'], [data-cy='l2-whatsapp']"),
      0,
      "no WhatsApp link",
    );
    await expect.notSee("WhatsApp");
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
    // the phone and email links
    expect(
      (await count(page, "a[href='tel:+18553628666']")) >= 5,
      "the phone links dial the support line — nav, signup, team, Projects, footer (the bottom Call us buttons scroll instead, REQ-092)",
    );
    expect((await count(page, "a[href^='mailto:']")) >= 1, "the email link");
    // the in-page buttons: Start free → the signup, Book a demo → the demo
    await page.locator("[data-cy='l2-nav'] a[href='#empezar']").click();
    expect(
      await page.locator("#empezar").evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.top >= -2 && r.top < innerHeight;
      }),
      "Start free scrolls to the signup card",
    );
    await page.locator("[data-cy='l2-final'] a[href='#demo']").click();
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
    // the sticky bar: start and call on a phone, gone on a desktop
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
    expect.eq(await bar.locator("a").count(), 2, "two buttons: start and call");
    expect.eq(
      await bar.locator("a[href='#llamanos']").count(),
      1,
      "the call button scrolls to the call-us section (REQ-092)",
    );
    await bar.locator("a[href='#empezar']").click();
    expect(
      await page.locator("#empezar").evaluate((el: HTMLElement) =>
        el.getBoundingClientRect().top < innerHeight
      ),
      "the bar's Start free reaches the signup",
    );
  }));

Deno.test("REQ-089: the signup card is the mock's — the consent box starts unticked and holds the code until it is ticked, then the code goes out, opens the account and goes straight into the app, and the Lead fires once", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    const drain = watchPixel(page);
    const posts = watchPosts(page, "/auth/send-otp");
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2");
    await expect.see("Empieza gratis en 30 segundos");
    await drain(); // the PageView
    // the card as the mock drew it: the phone, Empezar gratis, the consent box unticked, the phone row
    const card = page.locator("[data-cy='l2-signup']");
    expect.eq(
      ((await card.locator("[data-cy='l2-send-code']").textContent()) ?? "")
        .trim(),
      "Empezar gratis",
      "the button says Empezar gratis",
    );
    const consent = page.locator("#reg-consent");
    expect.eq(
      await consent.isChecked(),
      false,
      "the consent box starts unticked",
    );
    await expect.see("Al tocar Empezar aceptas recibir textos de DocuMonster.");
    expect.eq(
      await card.locator("a[href='/sms-terms']").count(),
      1,
      "the consent's Términos link goes to the SMS terms",
    );
    await expect.see("¿Prefieres hablar?");
    expect.eq(
      await card.locator("a[href='tel:+18553628666']").count(),
      1,
      "the phone row dials the line",
    );
    // unticked: the code is held on the page, nothing is posted, no Lead
    const phone = `512${digits()}`;
    await page.locator("#reg-phone").fill(phone);
    await page.locator("[data-cy='l2-send-code']").click();
    await expect.see("Marca la casilla para que te mandemos el código.");
    expect.eq(posts(), 0, "nothing was posted without consent");
    expect.eq(
      await count(page, "[data-cy='l2-signup-step'][data-step='1']"),
      1,
      "still on the phone step",
    );
    expect.eq(
      (await drain()).filter((c) => c.name === "Lead").length,
      0,
      "no Lead without consent",
    );
    // ticked: the code goes out, on the same page — and the Lead, once
    await consent.check();
    await page.locator("[data-cy='l2-send-code']").click();
    await expect.see("Te mandamos un código de 6 dígitos");
    expect.eq(posts(), 1, "one POST once the box is ticked");
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
    // a wrong code is refused, on the page — the sixth digit submits by itself (REQ-083)
    expect.eq(
      await count(page, "[data-cy='l2-confirm-code']"),
      1,
      "the confirm button is there for a hand-typed code",
    );
    await page.locator("#reg-code").fill("111111");
    await expect.see("Ese código no es correcto");
    // the right code opens the account (the dev master code on the fakes) and goes straight into the
    // app — no card, no button (REQ-081's amendment stands)
    await page.locator("#reg-code").fill("000000");
    await page.waitForURL((u: URL) => u.pathname !== "/landing2", {
      timeout: 60_000,
    });
    expect.eq(
      (await drain()).filter((c) => c.name === "Lead").length,
      0,
      "no second Lead for the code",
    );
    await page.waitForLoadState("networkidle");
    const landed = new URL(page.url()).pathname;
    expect(
      landed !== "/login" && landed !== "/landing2",
      `signed in and inside the app (${landed})`,
    );
    // back on the landing: the Lead's once-per-browser guard is on record, and a second code for the
    // same number inside 30 s is the cooldown, said on the page (P-03)
    await page.goto(`${baseUrl}/landing2`);
    await drain();
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).some((k) => k.startsWith("pm:px:lead:"))
      ),
      "the Lead's once-per-browser guard is on record",
    );
    await page.locator("#reg-consent").check();
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

Deno.test("REQ-090: the demo card — Llámenme with just a cell books a call as soon as possible; the day-and-window form books a demo; each holds until its consent box is ticked; the team is emailed, the person is texted, and the phone is a lead", (t) =>
  story(t, async ({ page, expect }) => {
    const posts = watchPosts(page, "/api/demo-request");
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await expect.see("Want to see it first? We’ll call you.");
    await page.locator("#demo").scrollIntoViewIfNeeded();
    // one card: the copy on the left, the form on the right
    expect.eq(
      await count(page, "[data-cy='l2-demo'] [data-cy='l2-demo-card']"),
      1,
      "the demo is one card",
    );
    expect.eq(
      await count(page, "[data-cy='l2-demo-card'] [data-cy='l2-demo-form']"),
      1,
      "the form is inside it",
    );
    // Llámenme: just a cell — held until the box is ticked
    const quickPhone = `512${digits()}`;
    await page.locator("#demo-phone").fill(quickPhone);
    expect.eq(
      await page.locator("#demo-consent").isChecked(),
      false,
      "the demo's consent box starts unticked",
    );
    await page.locator("[data-cy='l2-demo-call']").click();
    await expect.see("Tick the box so we can text or call you.");
    expect.eq(posts(), 0, "nothing was posted without consent");
    await page.locator("#demo-consent").check();
    const [res] = await Promise.all([
      page.waitForResponse((
        r: { url(): string; request(): { method(): string } },
      ) =>
        r.url().includes("/api/demo-request") && r.request().method() === "POST"
      ),
      page.locator("[data-cy='l2-demo-call']").click(),
    ]);
    const body = await res.json();
    expect.eq(body.ok, true, `the call was booked (${JSON.stringify(body)})`);
    expect.eq(body.mode, "call", "a call");
    expect.eq(body.day, "", "as soon as possible: no day…");
    expect.eq(body.slot, "", "…and no window");
    expect.eq(body.emailed, true, "the team was emailed");
    expect.eq(
      typeof body.texted,
      "boolean",
      "the server says whether the person was texted",
    );
    expect.eq(body.lead, true, "the phone is a lead");
    await expect.see("Done!");
    await expect.see(
      body.texted
        ? "We confirm by text. No commitment."
        : "We could not text you, but your booking is in",
    );
    // the day-and-window form, Spanish (an explicit ?lang= is a choice the site persists — asked by name)
    await page.goto("/landing2?lang=es");
    await page.locator("#demo").scrollIntoViewIfNeeded();
    await clickUntil(
      page,
      "[data-cy='l2-pick-time']",
      async () => (await count(page, "[data-cy='l2-day']")) > 0,
    );
    expect.eq(
      await count(page, "[data-cy='l2-day']"),
      DEMO_DAY_COUNT,
      "five days to pick",
    );
    expect.eq(
      await count(page, "[data-cy='l2-slot']"),
      DEMO_SLOTS.length,
      "two windows to pick",
    );
    await expect.see("Mañana (9–12)");
    await expect.see("Tarde (1–5)");
    const summary = page.locator("[data-cy='l2-demo-summary']");
    expect(
      /^Demo · .+ · Mañana, 9 AM – 12 PM \(hora del Este\)$/.test(
        ((await summary.textContent()) ?? "").replace(/\s+/g, " ").trim(),
      ),
      `the summary starts on the demo, the first day, the morning (${await summary
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
      "[data-cy='l2-slot'] >> nth=1",
      async () =>
        (await page.locator("[data-cy='l2-slot']").nth(1).getAttribute("class"))
          ?.includes("on") ?? false,
    );
    const dayIso = await page.locator("[data-cy='l2-day']").nth(2).getAttribute(
      "data-day",
    );
    expect(
      ((await summary.textContent()) ?? "").includes("Tarde, 1 – 5 PM"),
      "the summary follows the window",
    );
    // the details: a name is needed, the consent box too; the email is optional
    await page.locator("#f-phone").fill(`512${digits()}`);
    await page.locator("[data-cy='l2-demo-submit']").click();
    await expect.see("Escribe tu nombre.");
    await page.locator("#f-name").fill("José García");
    await page.locator("[data-cy='l2-demo-submit']").click();
    await expect.see(
      "Marca la casilla para que podamos escribirte o llamarte.",
    );
    expect.eq(posts(), 1, "nothing more was posted without consent");
    await page.locator("#f-email").fill("jose@tunegocio.com");
    await page.locator("#demo-consent").check();
    const [res2] = await Promise.all([
      page.waitForResponse((
        r: { url(): string; request(): { method(): string } },
      ) =>
        r.url().includes("/api/demo-request") && r.request().method() === "POST"
      ),
      page.locator("[data-cy='l2-demo-submit']").click(),
    ]);
    const body2 = await res2.json();
    expect.eq(body2.ok, true, `the demo was booked (${JSON.stringify(body2)})`);
    expect.eq(body2.mode, "demo", "a demo");
    expect.eq(body2.day, dayIso, "the day picked");
    expect.eq(body2.slot, "afternoon", "the window picked");
    expect.eq(body2.lead, true, "the phone is a lead");
    await expect.see("¡Listo!");
    await expect.see(
      body2.texted
        ? "Te confirmamos por texto. Sin compromiso."
        : "No pudimos mandarte el texto",
    );
    // ← Solo llámenme goes back to the one-field form
    await page.goto("/landing2?lang=es");
    await page.locator("#demo").scrollIntoViewIfNeeded();
    await clickUntil(
      page,
      "[data-cy='l2-pick-time']",
      async () => (await count(page, "[data-cy='l2-day']")) > 0,
    );
    await clickUntil(
      page,
      "[data-cy='l2-quick-mode']",
      async () => (await count(page, "#demo-phone")) > 0,
    );
    expect.eq(
      await count(page, "[data-cy='l2-day']"),
      0,
      "the day picker is gone again",
    );
  }));

/**
 * Raphael's feedback on the shown page, 2026-10-16: "the english spanish toggle looks like ass when
 * toggling, if you click it at all it should toggle to the opposite, you should not have to click
 * the letters." · "need more contrast on this button" (1-855-DocuMon, dark on dark) · "more
 * contrast on this button" (Call us, the same) · "this is cut off" (the day picker's last day).
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
      INK,
      "EN ink",
    );
  }));

Deno.test("REQ-081: every dark button has white text and every light button has ink text, at rest and on hover", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    const WHITE = "rgb(255, 255, 255)";
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
    expect.eq(
      await color("[data-cy='l2-signup'] a.l2-btn--ghost"),
      INK,
      "the signup card's phone button is ink on white",
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
      await count(page, "a.l2-btn--dark, button.l2-btn--dark"),
      await page.locator("a.l2-btn--dark, button.l2-btn--dark").evaluateAll((
        els: HTMLElement[],
      ) =>
        els.filter((el) => getComputedStyle(el).color === "rgb(255, 255, 255)")
          .length
      ),
      "every dark button on the page",
    );
  }));

Deno.test("REQ-090: all five days of the demo's day picker sit whole inside the card, on a desktop and on a phone", (t) =>
  story(t, async ({ page, expect }) => {
    for (const vp of [DESKTOP, PHONE]) {
      await page.setViewportSize(vp);
      // a second goto that differs only by its hash is a same-document jump — the island would keep
      // its state and the link would be gone: ask for the page afresh and scroll to the demo
      await page.goto(`/landing2?lang=en&vp=${vp.width}`);
      await page.locator("#demo").scrollIntoViewIfNeeded();
      await clickUntil(
        page,
        "[data-cy='l2-pick-time']",
        async () => (await count(page, "[data-cy='l2-day']")) > 0,
      );
      const days = page.locator("[data-cy='l2-day']");
      expect.eq(
        await days.count(),
        DEMO_DAY_COUNT,
        `five days at ${vp.width}px`,
      );
      const card =
        (await page.locator("[data-cy='l2-demo-card']").boundingBox())!;
      for (let i = 0; i < DEMO_DAY_COUNT; i++) {
        const b = (await days.nth(i).boundingBox())!;
        expect(
          b.x >= card.x && b.x + b.width <= card.x + card.width + 0.5,
          `day ${i + 1} is whole inside the card at ${vp.width}px (${
            Math.round(b.x + b.width)
          } ≤ ${Math.round(card.x + card.width)})`,
        );
      }
      const row = page.locator("[data-cy='l2-demo-card'] .l2-demo__days");
      expect(
        await row.evaluate((el: HTMLElement) =>
          el.scrollWidth <= el.clientWidth + 1
        ),
        `nothing to scroll at ${vp.width}px`,
      );
      const scrollW = await page.evaluate(() =>
        document.documentElement.scrollWidth
      );
      expect(
        scrollW <= vp.width,
        `nothing wider than the screen at ${vp.width}px (${scrollW})`,
      );
    }
  }));

/** REQ-084 — Raphael, 2026-10-18, on the signup card: "make it so there is no autofill." */
Deno.test("REQ-084: the signup card asks the browser for no autofill — the phone field and the code field carry autocomplete=off, no name, and the password managers' ignore flags", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    const attrs = (sel: string) =>
      page.locator(sel).evaluate((el: HTMLInputElement) => ({
        autocomplete: el.getAttribute("autocomplete"),
        name: el.getAttribute("name"),
        lp: el.getAttribute("data-lpignore"),
        op: el.hasAttribute("data-1p-ignore"),
        dl: el.getAttribute("data-form-type"),
      }));
    const phone = await attrs("#reg-phone");
    expect.eq(
      JSON.stringify(phone),
      JSON.stringify({
        autocomplete: "off",
        name: null,
        lp: "true",
        op: true,
        dl: "other",
      }),
      `the phone field (${JSON.stringify(phone)})`,
    );
    await page.locator("#reg-consent").check(); // REQ-089: the consent box gates the code
    await page.locator("#reg-phone").fill(`512${digits()}`);
    await page.locator("[data-cy='l2-send-code']").click();
    await page.locator("[data-cy='l2-signup-step'][data-step='2']").waitFor({
      timeout: 15_000,
    });
    const code = await attrs("#reg-code");
    expect.eq(
      JSON.stringify(code),
      JSON.stringify({
        autocomplete: "off",
        name: null,
        lp: "true",
        op: true,
        dl: "other",
      }),
      `the code field (${JSON.stringify(code)})`,
    );
  }));

Deno.test(
  "REQ-092: the Llámanos button at the bottom — the sticky bar on a phone, the final CTA on a desktop — scrolls to the call-us section, and every 1-855 button is a plain tel: link the browser hands to the dialer",
  (t) =>
    story(t, async ({ page, expect }) => {
      // the call-us section is the team: Art and Ben, the number and the hours
      await page.setViewportSize(DESKTOP);
      await page.goto("/landing2?lang=en");
      await expect.see("that win you the job.");
      const callUs = page.locator("#llamanos");
      expect.eq(await callUs.count(), 1, "the page has one call-us anchor");
      expect.eq(
        await callUs.getAttribute("data-cy"),
        "l2-team",
        "the anchor is the team section",
      );
      expect.eq(
        await callUs.locator("[data-cy='l2-member']").count(),
        2,
        "Art and Ben are in it",
      );
      expect.eq(
        await callUs.locator("a[href='tel:+18553628666']").count(),
        1,
        "and so is the 1-855 button",
      );
      // a desktop: the final CTA's Call us scrolls there; the page never leaves
      const finalCall = page.locator("[data-cy='l2-final'] a.l2-btn--dark");
      expect.eq(
        await finalCall.getAttribute("href"),
        "#llamanos",
        "the final CTA's Call us points at the call-us section",
      );
      await finalCall.scrollIntoViewIfNeeded();
      expect(
        await callUs.evaluate((el: HTMLElement) =>
          el.getBoundingClientRect().bottom < 0
        ),
        "at the final CTA the call-us section is above the screen",
      );
      await finalCall.click();
      expect(
        await callUs.evaluate((el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return r.top >= -2 && r.top < innerHeight / 2;
        }),
        "Call us scrolls the call-us section to the top of the screen",
      );
      expect.eq(
        await page.evaluate(() => location.pathname + location.hash),
        "/landing2#llamanos",
        "the page stays; the hash names the section",
      );
      expect(
        await callUs.locator("a[href='tel:+18553628666']").isVisible(),
        "the 1-855 button is on the screen",
      );
      await expect.see("8 AM – 8 PM");
      // a phone: the sticky bar's Call us does the same
      await page.setViewportSize(PHONE);
      await page.goto("/landing2?lang=en&vp=390");
      await expect.see("that win you the job.");
      const bar = page.locator("[data-cy='l2-stickybar']");
      expect(await bar.isVisible(), "the sticky bar on a phone");
      const barCall = bar.locator("a.l2-btn--dark");
      expect.eq(
        await barCall.getAttribute("href"),
        "#llamanos",
        "the bar's Call us points at the call-us section",
      );
      expect(
        await callUs.evaluate((el: HTMLElement) =>
          el.getBoundingClientRect().top > innerHeight
        ),
        "at the top of the page the call-us section is below the screen",
      );
      await barCall.click();
      expect(
        await callUs.evaluate((el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return r.top >= -2 && r.top < innerHeight / 2;
        }),
        "the bar's Call us scrolls the call-us section onto the screen",
      );
      expect(
        await callUs.locator("a[href='tel:+18553628666']").isVisible(),
        "the 1-855 button is on the phone's screen",
      );
      // every 1-855 button is a plain tel: link — the number as the browser dials it, no script in the way
      const tel = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLAnchorElement>("a[href^='tel:']")]
          .map((a) => ({
            href: a.getAttribute("href"),
            text: (a.textContent ?? "").trim(),
            plain: a.onclick === null && !a.hasAttribute("onclick") &&
              a.target === "",
          }))
      );
      expect(
        tel.length >= 5,
        `the 1-855 buttons — nav, signup, team, Projects, footer (${tel.length})`,
      );
      for (const a of tel) {
        expect.eq(
          a.href,
          "tel:+18553628666",
          `"${a.text}" dials the support line as the browser expects it`,
        );
        expect(a.plain, `"${a.text}" has no script and no target in the way`);
      }
      expect.eq(
        await count(
          page,
          "[data-cy='l2-final'] a[href^='tel:'], [data-cy='l2-stickybar'] a[href^='tel:']",
        ),
        0,
        "the bottom Call us buttons are no longer tel: links",
      );
    }),
);

Deno.test(
  "REQ-093: the Big jobs, plans or bids line under the plan cards has 10px of padding on every side, on a desktop and on a phone",
  (t) =>
    story(t, async ({ page, expect }) => {
      for (const vp of [DESKTOP, PHONE]) {
        await page.setViewportSize(vp);
        await page.goto(`/landing2?lang=en&vp=${vp.width}`);
        await expect.see("Big jobs, plans or bids?");
        const line = page.locator("[data-cy='l2-projects']");
        await line.scrollIntoViewIfNeeded();
        const m = await line.evaluate((el: HTMLElement) => {
          const cs = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          const cards = document.querySelector(".l2-three--plans")!
            .getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const text = range.getBoundingClientRect();
          return {
            padding: [
              cs.paddingTop,
              cs.paddingRight,
              cs.paddingBottom,
              cs.paddingLeft,
            ].join(" "),
            textBelowCards: text.top - cards.bottom,
            textInsetLeft: text.left - box.left,
            textInsetRight: box.right - text.right,
            textInsetBottom: box.bottom - text.bottom,
          };
        });
        expect.eq(
          m.padding,
          "10px 10px 10px 10px",
          `10px of padding on every side at ${vp.width}`,
        );
        expect(
          m.textBelowCards >= 9.5,
          `the text sits at least 10px below the cards at ${vp.width} (${
            m.textBelowCards.toFixed(1)
          })`,
        );
        expect(
          m.textInsetLeft >= 9.5 && m.textInsetRight >= 9.5 &&
            m.textInsetBottom >= 9.5,
          `the text keeps 10px from the line's edges at ${vp.width}`,
        );
      }
    }),
);

Deno.test("REQ-094: the fine-tooth comb — on a tablet nothing is wider than the screen and the monster's disc stays round; the plan blurbs and the plans subtitle keep the mock's spacing; the share image every landing's og:image names answers at 1200×630; an empty Empezar gratis is answered on the page, in its language", (t) =>
  story(t, async ({ page, expect }) => {
    // a tablet in portrait: the hero's 118% monster image used to push a sideways scroll
    await page.setViewportSize(TABLET);
    await page.goto("/landing2?lang=en");
    await expect.see("that win you the job.");
    const tabletScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth
    );
    expect(
      tabletScroll <= TABLET.width,
      `nothing wider than the tablet (${tabletScroll} ≤ ${TABLET.width})`,
    );
    const disc = await page.locator("[data-cy='l2-monster']").evaluate((
      el: HTMLElement,
    ) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    expect(
      disc.w === disc.h,
      `the monster's disc is round (${disc.w}×${disc.h})`,
    );
    // a desktop: the margins the stylesheet declares on the plan blurbs and the plans subtitle
    // apply — the page's paragraph reset no longer outranks them
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await expect.see(
      "A lost invoice costs you more than a year of DocuMonster.",
    );
    const margins = await page.evaluate(() => {
      const m = (sel: string) =>
        getComputedStyle(document.querySelector(sel) as HTMLElement);
      return {
        subTop: m(".l2-plan__sub").marginTop,
        subBottom: m(".l2-plan__sub").marginBottom,
        plansSub: m(".l2-plans__sub").marginTop,
        note: m(".l2-plans__note").padding,
      };
    });
    expect.eq(margins.subTop, "-4px", "the plan blurb's top margin applies");
    expect.eq(
      margins.subBottom,
      "4px",
      "the plan blurb's bottom margin applies",
    );
    expect.eq(margins.plansSub, "6px", "the plans subtitle's margin applies");
    expect.eq(
      margins.note,
      "10px",
      "the Projects line keeps its 10px of padding (REQ-093)",
    );
    // the share image the page's og:image names: a PNG of the size the tags declare
    const og = await page.evaluate(async () => {
      const href =
        document.querySelector("meta[property='og:image']")?.getAttribute(
          "content",
        ) ?? "";
      const path = new URL(href).pathname;
      const r = await fetch(path);
      const type = r.headers.get("content-type") ?? "";
      if (!r.ok || !type.startsWith("image/")) {
        return { path, status: r.status, type, w: 0, h: 0 };
      }
      const bmp = await createImageBitmap(await r.blob());
      return { path, status: r.status, type, w: bmp.width, h: bmp.height };
    });
    expect.eq(og.status, 200, `${og.path} answers`);
    expect(og.type.startsWith("image/png"), `a PNG (${og.type})`);
    expect.eq(`${og.w}×${og.h}`, "1200×630", "1200×630, Facebook's large card");
    // an empty Empezar gratis: the page's own message, not the browser's tooltip
    await clickUntil(
      page,
      "[data-cy='l2-send-code']",
      async () =>
        (await count(page, "[data-cy='l2-signup'] [role='alert']")) > 0,
    );
    await expect.see("Enter a valid cell number.");
    expect.eq(
      await count(page, "[data-cy='l2-signup-step'][data-step='1']"),
      1,
      "still on the phone step",
    );
  }));

Deno.test("REQ-095: the second comb — the page has its landmarks and the brand goes to the very top; the head names both language variants; the footer's year is this year; the demo's window group has a name and the hero's English note is marked English; the footer's policy links are 24px tap targets; on a tablet the headline is the phone's size, four lines at most", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2?lang=en");
    await expect.see("that win you the job.");
    // the landmarks a screen reader jumps by
    const marks = await page.evaluate(() => ({
      header: document.querySelectorAll(".l2 > header").length,
      main: document.querySelectorAll(".l2 > main").length,
      footer: document.querySelectorAll(".l2 > footer").length,
      top: document.getElementById("top")?.className ?? "",
    }));
    expect.eq(marks.header, 1, "one <header>: the nav");
    expect.eq(marks.main, 1, "one <main>: the page's sections");
    expect.eq(marks.footer, 1, "one <footer>");
    expect.eq(marks.top, "l2", "#top is the page itself, not the hero");
    // the head: both language variants and a default, and the font host warmed
    const alts = await page.evaluate(() =>
      [...document.querySelectorAll("link[rel='alternate'][hreflang]")].map((
        l,
      ) => `${l.getAttribute("hreflang")}=${l.getAttribute("href")}`).sort()
    );
    expect.eq(
      alts.join(" "),
      "en=https://documonster.com/landing2?lang=en es=https://documonster.com/landing2?lang=es x-default=https://documonster.com/landing2",
      "es, en and a default",
    );
    expect.eq(
      await count(
        page,
        "link[rel='preconnect'][href='https://fonts.gstatic.com']",
      ),
      1,
      "the font host is warmed",
    );
    // the footer's year is the clock's
    await expect.see(`© ${new Date().getFullYear()} DocuMonster`);
    // the hero note's English lines are marked English (REQ-096: the lines, not the whole note)
    expect.eq(
      await page.locator("[data-cy='l2-hero'] .l2-note--got .l2-note__quote")
        .getAttribute("lang"),
      "en",
      "the hero note's quote line carries lang=en",
    );
    // the footer's policy links are tap targets
    const legal = await page.evaluate(() =>
      [...document.querySelectorAll("[data-cy='l2-footer'] a[data-legal-link]")]
        .map((a) => Math.round(a.getBoundingClientRect().height))
    );
    expect(
      legal.length === 4 && legal.every((h) => h >= 24),
      `four policy links, each at least 24px tall (${legal})`,
    );
    // the demo's window group is named like the day group
    await clickUntil(
      page,
      "[data-cy='l2-pick-time']",
      async () => (await count(page, "[data-cy='l2-slot']")) > 0,
    );
    expect.eq(
      await page.locator(".l2-demo__slots").getAttribute("aria-label"),
      "Pick a window",
      "the window group's name",
    );
    // the brand goes to the very top of the page
    expect(
      (await page.evaluate(() => scrollY)) > 0,
      "scrolled down to the demo first",
    );
    await page.locator(".l2-brand").click();
    expect.eq(
      await page.evaluate(() => scrollY),
      0,
      "the brand scrolls to the very top",
    );
    // a tablet: the headline at the phone's size, four lines at most
    await page.setViewportSize(TABLET);
    await page.goto("/landing2?lang=es");
    await expect.see("que te ganan el trabajo.");
    const h1 = await page.locator("[data-cy='l2-hero'] h1").evaluate((
      el: HTMLElement,
    ) => {
      const size = parseFloat(getComputedStyle(el).fontSize);
      return {
        size,
        lines: Math.round(el.getBoundingClientRect().height / (size * 1.02)),
      };
    });
    expect(
      h1.size >= 40 && h1.size <= 48,
      `the headline is between 40 and 48px on a tablet (${h1.size})`,
    );
    expect(h1.lines <= 4, `four lines at most (${h1.lines})`);
  }));

Deno.test("REQ-096: the third comb — the stylesheet's link is cache-busted; the hero note's Spanish label is not marked English while its quote lines and the team's English role are; the signup card's title and the demo's thanks are headings; the language toggle says where it goes", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing2");
    await expect.see("que te ganan el trabajo.");
    // the stylesheet carries the build id, like every image on the page
    const css = await page.evaluate(() =>
      document.querySelector("link[rel='stylesheet'][href*='landing2.css']")
        ?.getAttribute("href") ?? ""
    );
    expect(
      css.includes("__frsh_c="),
      `the stylesheet link carries the build id (${css})`,
    );
    // lang marks: the English lines, and only them
    const langs = await page.evaluate(() => {
      const mark = (s: string) =>
        document.querySelector(s)?.closest("[lang]")?.getAttribute("lang");
      return {
        label: mark(".l2-note--got .l2-note__k"),
        quote: mark(".l2-note--got .l2-note__quote"),
        signed: mark(".l2-note--got .l2-note__signed"),
        role: mark(".l2-member__role"),
      };
    });
    expect.eq(
      langs.label,
      "es",
      "the note's label, Tu cliente recibió, is Spanish",
    );
    expect.eq(langs.quote, "en", "the quote line is English");
    expect.eq(langs.signed, "en", "the signed line is English");
    expect.eq(langs.role, "en", "Monster Success Specialist is English");
    // the signup card's title is a heading
    const headings = await page.evaluate(() =>
      [...document.querySelectorAll(".l2 h1, .l2 h2, .l2 h3")].map((h) =>
        `${h.tagName}:${(h.textContent ?? "").trim().slice(0, 30)}`
      )
    );
    expect(
      headings.includes("H2:Empieza gratis en 30 segundos"),
      `the signup card's title is a heading (${headings.join(" | ")})`,
    );
    // the toggle says where it goes, both ways
    expect.eq(
      await page.locator("[data-cy='l2-lang']").getAttribute("aria-label"),
      "Cambiar a inglés",
      "the toggle's name on the Spanish page",
    );
    await page.locator("[data-cy='l2-lang']").click();
    await page.waitForURL((u: URL) => u.searchParams.get("lang") === "en");
    expect.eq(
      await page.locator("[data-cy='l2-lang']").getAttribute("aria-label"),
      "Switch to Spanish",
      "and on the English page",
    );
    // the demo's thanks is a heading: book a call and read it
    await page.locator("#demo-phone").fill(`512${digits()}`);
    await page.locator("#demo-consent").check();
    await clickUntil(
      page,
      "[data-cy='l2-demo-call']",
      async () => (await count(page, "[data-cy='l2-demo-done']")) > 0,
    );
    expect.eq(
      await count(page, "[data-cy='l2-demo-done'] h3"),
      1,
      "Done! is a heading",
    );
  }));
