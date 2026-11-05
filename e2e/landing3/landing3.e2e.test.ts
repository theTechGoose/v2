/**
 * REQ-147 — Raphael, 2026-11-05: "look at landing 1, then landing2, take notes. then implement
 * landing3 landing4 landing5. make sure all of the buttons and ctas and everything works just as
 * it works in landing 1 and 2." — /landing3 is the "Landing v3" mock (landing-variations/v3, Nov 3):
 * the page opens on the ad the person tapped.
 *
 * The page: front-end/routes/landing3.tsx over front-end/components/Landing3Sections.tsx (SSR,
 * Spanish first, English on the toggle), its islands — Landing2Signup (the same OTP flow as
 * /landing2, inline in the signup card), Landing3Contact (→ POST /contact) and Landing2Demo
 * (→ POST /demo-request) — and front-end/static/landing3.css over landing2.css. The stories run on
 * the fakes: the code is the dev master code, the text and the email go nowhere but are reported
 * done, the pixel is the app's own fake.
 */
import { story, type StoryTools } from "#shots";
import { LEGAL_LINKS } from "../../shared/legal/terms.ts";
import { PUBLIC_PLANS } from "../../shared/quote-flow/pricing-plans.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const INK = "rgb(21, 32, 43)";
const CARD_PLANS = PUBLIC_PLANS.filter((p) => !p.custom);
const LINE_PLANS = PUBLIC_PLANS.filter((p) => p.custom);
const ADS = ["cumple", "domingo", "sabado", "graduacion"];
const HEADLINE_ES: Record<string, string> = {
  cumple: "Los cumpleaños son para esto.",
  domingo: "Los domingos son para esto.",
  sabado: "El sábado es tuyo.",
  graduacion: "Este día no se repite.",
};

interface PixelCall {
  name: string;
  eventId?: string;
}

/** the pixel's events since the last drain — the fake's record, or the real loader's requests */
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

const loaded = (page: StoryTools["page"], selector: string) =>
  page.locator(selector).first().evaluate((el: HTMLImageElement) =>
    el.complete && el.naturalWidth > 0
  );

/** an island may still be hydrating when its button appears: click until the page shows the effect */
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

const inView = (page: StoryTools["page"], selector: string) =>
  page.locator(selector).evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.top >= -2 && r.top < innerHeight;
  });

Deno.test("REQ-147: /landing3 is the v3 mock top to bottom — Spanish first, English on the toggle, on a desktop and on a phone", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing3");
    // Spanish first, no cookie, whatever the browser says (REQ-002)
    await expect.see("Los cumpleaños son para esto.");
    await expect.see(
      "Levántate del escritorio, que el Monstruo se encarga del papeleo.",
    );
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "es",
      "<html lang> is es",
    );
    // every section of the mock, in its order
    const order = [
      "nav",
      "ad",
      "signup",
      "proof",
      "outcomes",
      "contact",
      "team",
      "demo",
      "plans",
      "faq",
      "final",
      "footer",
    ];
    let last = -1;
    for (const section of order) {
      expect.eq(
        await count(page, `[data-cy='l3-${section}']`),
        1,
        `the ${section} section is on the page`,
      );
      const y = await top(page, `[data-cy='l3-${section}']`);
      expect(
        y >= last,
        `${section} comes after the section before it (${y} ≥ ${last})`,
      );
      last = y;
    }
    expect.eq(
      await count(page, "[data-cy='l2-signup']"),
      1,
      "the signup card is on the page",
    );
    expect.eq(
      await page.locator("[data-cy='l3-proof']").evaluate((el: HTMLElement) =>
        getComputedStyle(el).backgroundColor
      ),
      INK,
      "the proof section is an ink band",
    );
    await expect.see("Empieza gratis hoy");
    await expect.see("Un mensaje. Tres documentos.");
    await expect.see("COTIZACIÓN #PM-2641");
    await expect.see("Ganas más trabajos");
    await expect.see("Recuperas tus noches con la familia");
    await expect.see("¿Tienes preguntas? Escríbenos.");
    await expect.see(
      "Personas reales que hablan español. Siete días a la semana.",
    );
    await expect.see("¿Quieres verlo primero? Te llamamos o agenda tu demo.");
    await expect.see(
      "Una factura perdida te cuesta más que un año de DocuMonster.",
    );
    await expect.see("¿Todavía tienes dudas? DocuMonster no.");
    await expect.see("Deja el Papeleo al Monstruo.");
    await expect.see("Tú sigue en la obra. Y llega a casa a tiempo.");
    // the photos: the ad, the three moments, the four people
    expect(
      await loaded(page, "[data-cy='l3-ad'] img[src^='/ad-cumple.jpg']"),
      "the ad photo loaded",
    );
    for (const who of ["art", "ben", "sergio", "keren"]) {
      expect(
        await loaded(page, `[data-cy='l3-team'] img[src^='/team-${who}.jpg']`),
        `${who}'s photo loaded`,
      );
    }
    await expect.see("Monster Success Specialist");
    // no tagline (REQ-071), no WhatsApp
    await expect.notSee("Powered by Paperwork Monster");
    await expect.notSee("WhatsApp");
    // English on the toggle — one link, a click anywhere flips it
    expect.eq(await count(page, "[data-cy='l3-lang']"), 1, "one toggle");
    await page.locator("[data-cy='l3-lang']").click();
    await page.waitForURL((u: URL) => u.searchParams.get("lang") === "en");
    // REQ-147 amendment: the English card's button is Get started (Raphael, 2026-11-05)
    expect.eq(
      ((await page.locator("[data-cy='l2-send-code']").textContent()) ?? "")
        .trim(),
      "Get started",
      "the English signup button says Get started",
    );
    await expect.see("By tapping Get started you agree");
    await expect.see("Birthdays are for this.");
    await expect.see(
      "Step away from your desk because the Monster is here to handle the paperwork.",
    );
    await expect.see("Start free today");
    await expect.see("One message. Three documents.");
    await expect.see("You win more jobs");
    await expect.see("Have questions? Write to us.");
    await expect.see("Real people speaking Spanish. Seven days a week.");
    await expect.see(
      "Want to see it first? We’ll call you, or book your demo.",
    );
    await expect.see("Still have doubts? DocuMonster doesn’t.");
    await expect.see("Leave the Paperwork to the Monster.");
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "<html lang> is en",
    );
    await expect.notSee("Los cumpleaños son para esto.");
    // and back
    await page.locator("[data-cy='l3-lang']").click();
    await page.waitForURL((u: URL) => u.searchParams.get("lang") === "es");
    await expect.see("Los cumpleaños son para esto.");
    // the phone: one column, the two-button sticky bar at the bottom, nothing wider than the screen
    await page.setViewportSize(PHONE);
    await page.goto("/landing3");
    await expect.see("Los cumpleaños son para esto.");
    const bar = page.locator("[data-cy='l3-stickybar']");
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
    const scrollW = await page.evaluate(() =>
      document.documentElement.scrollWidth
    );
    expect(scrollW <= PHONE.width, `nothing wider than the phone (${scrollW})`);
    await page.locator("[data-cy='l3-plans']").scrollIntoViewIfNeeded();
    await page.locator("body").press("Shift"); // a frame of the plans on the phone
  }));

/** REQ-147 amendment 2 — the three pills one height, the three photo cards one top and one height */
async function outcomesAligned(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
) {
  // REQ-147 amendment 2: the three pills one height, the three photo cards one top and one height
  const pills = await page.locator("[data-cy='l3-outcome'] .l2-outcome")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(
    pills.length === 3 && pills.every((h) => Math.abs(h - pills[0]) < 1),
    `the three outcome pills share one height (${pills})`,
  );
  const cards = await page.locator("[data-cy='l3-outcome'] .l3-moment")
    .evaluateAll((els) =>
      els.map((
        e,
      ) => [e.getBoundingClientRect().top, e.getBoundingClientRect().height])
    );
  expect(
    cards.length === 3 &&
      cards.every((c) =>
        Math.abs(c[0] - cards[0][0]) < 1 && Math.abs(c[1] - cards[0][1]) < 1
      ),
    `the three photo cards share one top and one height (${
      JSON.stringify(cards)
    })`,
  );
}

Deno.test("REQ-147: the page opens on the ad the person tapped — ?ad= swaps the hero and the three outcome photos become the other three; unknown or absent is cumple", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    for (const ad of ADS) {
      await page.goto(`/landing3?ad=${ad}`);
      await expect.see(HEADLINE_ES[ad]);
      const hero = page.locator("[data-cy='l3-ad'] img[data-ad]");
      expect.eq(
        await hero.getAttribute("data-ad"),
        ad,
        `the hero is the ${ad} ad`,
      );
      expect.eq(
        (await hero.getAttribute("src"))?.split("?")[0],
        `/ad-${ad}.jpg`,
        `the hero photo is ${ad}'s`,
      );
      expect(
        await loaded(page, "[data-cy='l3-ad'] img[data-ad]"),
        `${ad}'s photo loaded`,
      );
      const outcomes = page.locator("[data-cy='l3-outcome'] img[data-ad]");
      expect.eq(await outcomes.count(), 3, "three outcome photos");
      await outcomesAligned(page, expect);
      const shown: string[] = [];
      for (let i = 0; i < 3; i++) {
        shown.push((await outcomes.nth(i).getAttribute("data-ad")) ?? "");
      }
      expect.eq(
        shown.join(","),
        ADS.filter((a) => a !== ad).join(","),
        `the outcomes show the other three (${shown})`,
      );
      for (const other of ADS.filter((a) => a !== ad)) {
        await expect.see(HEADLINE_ES[other]);
      }
    }
    await page.goto("/landing3?ad=navidad");
    await expect.see(HEADLINE_ES.cumple);
    expect.eq(
      await page.locator("[data-cy='l3-ad'] img[data-ad]").getAttribute(
        "data-ad",
      ),
      "cumple",
      "an unknown ad is cumple",
    );
    // the English page keeps the ad
    await page.goto("/landing3?ad=graduacion&lang=en");
    await expect.see("This day’s happiness only happens once.");
    await outcomesAligned(page, expect);
    expect.eq(
      await page.locator("[data-cy='l3-ad'] img[data-ad]").getAttribute(
        "data-ad",
      ),
      "graduacion",
      "the English page keeps the ad",
    );
  }));

Deno.test("REQ-147: the signup card works on the page as on /landing2 — the consent box is ticked when the page opens and holds the code while unticked, the code goes out, a wrong code is refused, the right one goes straight into the app, and the Lead fires once", (t) =>
  story(t, async ({ page, expect }) => {
    const drain = watchPixel(page);
    const posts = watchPosts(page, "/auth/send-otp");
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing3");
    await expect.see("Empieza gratis hoy");
    await drain(); // the PageView
    const card = page.locator("[data-cy='l2-signup']");
    expect.eq(
      ((await card.locator("[data-cy='l2-send-code']").textContent()) ?? "")
        .trim(),
      "Empezar gratis",
      "the button says Empezar gratis, as the mock",
    );
    const consent = page.locator("#reg-consent");
    expect.eq(
      await consent.isChecked(),
      true,
      "the consent box is ticked when the page opens (REQ-097)",
    );
    await expect.see("Al tocar Empezar aceptas recibir textos de DocuMonster.");
    expect.eq(
      await card.locator("a[href='/sms-terms']").count(),
      1,
      "the consent's Términos link goes to the SMS terms",
    );
    // the ¿Prefieres hablar? row dials the line
    expect.eq(
      await page.locator("[data-cy='l3-signup'] a[href='tel:+18553628666']")
        .count(),
      1,
      "the phone row dials the line",
    );
    // unticked by the person: the code is held on the page, nothing is posted, no Lead
    await consent.uncheck();
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
    // ticked again: the code goes out, on the same page — and the Lead, once
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
    // a wrong code is refused, on the page — the sixth digit submits by itself
    await page.locator("#reg-code").fill("111111");
    await expect.see("Ese código no es correcto");
    // the right code opens the account (the dev master code on the fakes) and goes straight into the app
    await page.locator("#reg-code").fill("000000");
    await page.waitForURL((u: URL) => u.pathname !== "/landing3", {
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
      landed !== "/login" && landed !== "/landing3",
      `signed in and inside the app (${landed})`,
    );
  }));

Deno.test("REQ-147: the contact form posts the inquiry and shows ¡Listo!, and the demo card books a call as on /landing2", (t) =>
  story(t, async ({ page, expect }) => {
    const contacts = watchPosts(page, "/contact");
    const demos = watchPosts(page, "/demo-request");
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing3");
    await expect.see("¿Tienes preguntas? Escríbenos.");
    // the contact card: name, cell, email, optional message, the consent box ticked on open
    await page.locator("#contacto").scrollIntoViewIfNeeded();
    expect.eq(
      await page.locator("#c-consent").isChecked(),
      true,
      "the contact consent box is ticked when the page opens (REQ-097)",
    );
    expect.eq(
      await page.locator("[data-cy='l3-contact'] a[href='/sms-terms']").count(),
      1,
      "its Términos link goes to the SMS terms",
    );
    expect.eq(
      await page.locator("[data-cy='l3-contact'] a[href='tel:+18553628666']")
        .count(),
      1,
      "Llámanos dials the line",
    );
    expect.eq(
      await page.locator("[data-cy='l3-contact'] a[href^='mailto:']").count(),
      1,
      "Escríbenos is the email",
    );
    // an empty send is answered on the page, in the page's language, and nothing is posted
    await page.locator("[data-cy='l3-contact-send']").click();
    await expect.see("Escribe tu nombre.");
    expect.eq(contacts(), 0, "nothing posted without a name");
    await page.locator("#c-name").fill("José García");
    await page.locator("#c-phone").fill(`512${digits()}`);
    await page.locator("#c-email").fill("jose@tunegocio.com");
    await clickUntil(
      page,
      "[data-cy='l3-contact-send']",
      async () => (await count(page, "[data-cy='l3-contact-done']")) > 0,
    );
    await expect.see("Te contestamos hoy. Si es tarde, mañana a primera hora.");
    expect.eq(contacts(), 1, "one POST /contact");
    // the demo card opens on Call me: the cell, the ticked box, Llámenme → Done
    await page.locator("#demo").scrollIntoViewIfNeeded();
    expect.eq(
      await count(page, "[data-cy='l2-demo-call']"),
      1,
      "the demo card opens on Llámenme",
    );
    expect.eq(
      await count(page, "[data-cy='l2-pick-time']"),
      1,
      "the day-and-time booking is behind its link",
    );
    await page.locator("[data-cy='l2-demo-form'] input[type='tel']").fill(
      `512${digits()}`,
    );
    await clickUntil(
      page,
      "[data-cy='l2-demo-call']",
      async () => (await count(page, "[data-cy='l2-demo-done']")) > 0,
    );
    await expect.see("Te confirmamos por texto. Sin compromiso.");
    expect.eq(demos(), 1, "one POST /demo-request");
  }));

Deno.test("REQ-147: the plans are the one list, the FAQ opens and closes, every link and button lands where it says, Llámanos scrolls to the people, and a phone shows the sticky bar", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing3?lang=en");
    await expect.see("Still have doubts? DocuMonster doesn’t.");
    // the proof band: the four bubbles and the three document rows
    expect.eq(
      await page.locator("[data-cy='l3-proof'] .l2-bubble").count(),
      4,
      "four chat bubbles",
    );
    await expect.see("QUOTE #PM-2641");
    await expect.see("CONTRACT #PM-2641");
    await expect.see("INVOICE #PM-2641-1");
    await expect.see("$10,990.00");
    // the outcomes: three cards, a photo and a headline under each
    const outcomes = page.locator("[data-cy='l3-outcome']");
    expect.eq(await outcomes.count(), 3, "three outcome cards");
    await expect.see("You win more jobs");
    await expect.see("You get paid faster");
    await expect.see("Sundays are for this.");
    // the team: four people, one dark phone button, the hours
    const members = page.locator("[data-cy='l3-member']");
    expect.eq(await members.count(), 4, "four people");
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      names.push(
        (await members.nth(i).locator("img").getAttribute("alt")) ?? "",
      );
    }
    expect.eq(
      names.join(","),
      "Art,Ben,Sergio,Keren",
      "Art, Ben, Sergio and Keren, in the mock's order",
    );
    await expect.see("Monday to Sunday, 8 AM – 8 PM");
    expect.eq(
      await count(
        page,
        "[data-cy='l3-team'] a.l2-btn--dark[href='tel:+18553628666']",
      ),
      1,
      "the one phone button of the team is a plain tel:",
    );
    // the plans: the cards from the one list — names, prices, features — and the Projects line
    const cards = page.locator("[data-cy='l3-plan']");
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
        ((await card.locator("[data-cy='l3-plan-price']").textContent()) ?? "")
          .trim();
      expect(
        price.startsWith(`$${Math.round(plan.priceCents / 100)}`),
        `${plan.id} shows its price (${price})`,
      );
      for (const f of plan.features) await expect.see(f.en);
      expect.eq(
        await card.locator("[data-cy='l3-plan-cta']").getAttribute("href"),
        "#empezar",
        `${plan.id}'s button goes to the signup`,
      );
    }
    expect.eq(
      await count(page, "[data-cy='l3-plan'][data-popular]"),
      1,
      "one plan is the popular one",
    );
    const line = page.locator("[data-cy='l3-projects']");
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
      await count(page, "[data-cy='l3-faq-point']"),
      4,
      "four points beside the questions",
    );
    const faqs = page.locator("[data-cy='l3-faq'] details");
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
    // the closing band: start, call, demo — three buttons
    const final = page.locator("[data-cy='l3-final']");
    expect.eq(
      await final.locator("a").count(),
      3,
      "three buttons in the closing",
    );
    expect.eq(
      await final.locator("a[href='#empezar']").count(),
      1,
      "Start free",
    );
    expect.eq(
      await final.locator("a[href='#llamanos']").count(),
      1,
      "Call us — to the people (REQ-092)",
    );
    expect.eq(await final.locator("a[href='#demo']").count(), 1, "Book a demo");
    // the policy links: the four, in order, to their own pages
    const legal = page.locator("[data-cy='l3-footer'] a[data-legal-link]");
    expect.eq(await legal.count(), LEGAL_LINKS.length, "the four policy links");
    for (let i = 0; i < LEGAL_LINKS.length; i++) {
      expect.eq(
        await legal.nth(i).getAttribute("href"),
        LEGAL_LINKS[i].path,
        `policy link ${i} is ${LEGAL_LINKS[i].path}`,
      );
    }
    expect(
      (await count(page, "a[href='tel:+18553628666']")) >= 6,
      "the phone links dial the support line — nav, signup, contact, team, demo, Projects, footer",
    );
    expect(
      (await count(page, "a[href^='mailto:']")) >= 3,
      "the email links — contact, demo, footer",
    );
    // the in-page buttons land: the nav's Start free → the signup, Book a demo → the demo, Call us → the people
    await page.locator("[data-cy='l3-nav'] a[href='#empezar']").click();
    expect(
      await inView(page, "#empezar"),
      "Start free scrolls to the signup card",
    );
    await page.locator("[data-cy='l3-final'] a[href='#demo']").click();
    expect(await inView(page, "#demo"), "Book a demo scrolls to the demo");
    await page.locator("[data-cy='l3-final'] a[href='#llamanos']").click();
    expect(await inView(page, "#llamanos"), "Call us scrolls to the people");
    // a policy link really lands on its page
    await page.locator("[data-cy='l3-footer'] a[data-legal-link='privacy']")
      .click();
    await page.waitForURL((u: URL) => u.pathname === "/privacy");
    await expect.see("Privacy Policy");
    // the sticky bar: start and call on a phone, gone on a desktop
    await page.goto("/landing3?lang=en");
    expect.eq(
      await page.locator("[data-cy='l3-stickybar']").isVisible(),
      false,
      "no sticky bar on a desktop",
    );
    await page.setViewportSize(PHONE);
    await page.goto("/landing3?lang=en");
    const bar = page.locator("[data-cy='l3-stickybar']");
    expect(await bar.isVisible(), "the sticky bar on a phone");
    expect.eq(await bar.locator("a").count(), 2, "two buttons: start and call");
    expect.eq(
      await bar.locator("a[href='#llamanos']").count(),
      1,
      "the call button scrolls to the people (REQ-092)",
    );
    await bar.locator("a[href='#empezar']").click();
    expect(
      await page.locator("#empezar").evaluate((el: HTMLElement) =>
        el.getBoundingClientRect().top < innerHeight
      ),
      "the bar's Start free reaches the signup",
    );
  }));
