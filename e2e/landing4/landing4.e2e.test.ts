/**
 * REQ-148 — Raphael, 2026-11-05: "implement landing3 landing4 landing5. make sure all of the
 * buttons and ctas and everything works just as it works in landing 1 and 2." — /landing4 is the
 * "Landing v4" mock (landing-variations/v4, Nov 3): /landing3 opening on "You do the work. We do
 * the paperwork." with the three steps, then the ad and the rest of /landing3.
 *
 * The page: front-end/routes/landing4.tsx over front-end/components/Landing3Sections.tsx; the same
 * islands and stylesheets as /landing3 (REQ-147). The stories run on the fakes.
 */
import { story, type StoryTools } from "#shots";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const count = async (page: StoryTools["page"], selector: string) =>
  await page.locator(selector).count();

const top = (page: StoryTools["page"], selector: string) =>
  page.locator(selector).evaluate((el: HTMLElement) =>
    el.getBoundingClientRect().top + globalThis.scrollY
  );

const inView = (page: StoryTools["page"], selector: string) =>
  page.locator(selector).evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.top >= -2 && r.top < innerHeight;
  });

Deno.test("REQ-148: /landing4 opens on You do the work with the three steps, then is /landing3 — Spanish first, English on the toggle, the two top links land on the signup and the documents, the ad still follows ?ad=, and a phone shows the sticky bar", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing4");
    // Spanish first: the top, the steps, then the ad
    await expect.see("Tú haces el trabajo.");
    await expect.see("Nosotros el papeleo.");
    await expect.see("Para contratistas y dueños de negocios de oficios");
    await expect.see("Plan gratis: 5 cotizaciones al mes");
    await expect.see("Crear mi cotización gratis");
    await expect.see("Ver un ejemplo primero →");
    await expect.see("Simple desde el primer trabajo.");
    await expect.see("Cuéntanos del trabajo");
    await expect.see("Revisa tus documentos");
    await expect.see("Envíalos a tu cliente");
    await expect.see(
      "Pintar 3 habitaciones. Materiales y mano de obra: $1,800.",
    );
    await expect.see("Los cumpleaños son para esto.");
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "es",
      "<html lang> is es",
    );
    // every section, in the mock's order: the top and the steps before the ad
    const order = [
      "nav",
      "top",
      "steps",
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
    expect.eq(await count(page, "[data-cy='l3-step']"), 3, "three steps");
    expect.eq(await count(page, "#anuncio"), 1, "the ad section is #anuncio");
    expect.eq(await count(page, "#top"), 1, "and #top is the page's top");
    // the two top links land: Create my free quote → the signup, See an example first → the documents
    await page.locator("[data-cy='l3-top'] a[href='#empezar']").click();
    expect(
      await inView(page, "#empezar"),
      "Crear mi cotización gratis scrolls to the signup card",
    );
    await page.locator("[data-cy='l3-top'] a[href='#documentos']").click();
    expect(
      await inView(page, "#documentos"),
      "Ver un ejemplo primero scrolls to the documents",
    );
    // the ad follows ?ad=
    await page.goto("/landing4?ad=sabado");
    await expect.see("El sábado es tuyo.");
    expect.eq(
      await page.locator("[data-cy='l3-ad'] img[data-ad]").getAttribute(
        "data-ad",
      ),
      "sabado",
      "the ad is sabado",
    );
    const shown: string[] = [];
    const outcomes = page.locator("[data-cy='l3-outcome'] img[data-ad]");
    for (let i = 0; i < 3; i++) {
      shown.push((await outcomes.nth(i).getAttribute("data-ad")) ?? "");
    }
    expect.eq(
      shown.join(","),
      "cumple,domingo,graduacion",
      "the outcomes show the other three",
    );
    // English on the toggle
    await page.locator("[data-cy='l3-lang']").click();
    await page.waitForURL((u: URL) => u.searchParams.get("lang") === "en");
    // REQ-147 amendment: the English card's button is Get started, here too (Raphael, 2026-11-05)
    expect.eq(
      ((await page.locator("[data-cy='l2-send-code']").textContent()) ?? "")
        .trim(),
      "Get started",
      "the English signup button says Get started on /landing4",
    );
    await expect.see("You do the work.");
    await expect.see("We do the paperwork.");
    await expect.see("For contractors and trade business owners");
    await expect.see("Free plan: 5 quotes per month");
    await expect.see("Create my free quote");
    await expect.see("See an example first →");
    await expect.see("Simple from the first job.");
    await expect.see("Saturday is yours.");
    await expect.see("Start free today");
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "<html lang> is en",
    );
    expect.eq(
      await page.locator("[data-cy='l3-ad'] img[data-ad]").getAttribute(
        "data-ad",
      ),
      "sabado",
      "the English page keeps the ad",
    );
    // the phone: the sticky bar, nothing wider than the screen
    await page.setViewportSize(PHONE);
    await page.goto("/landing4?lang=es"); // the toggle left the cookie on en
    await expect.see("Tú haces el trabajo.");
    const bar = page.locator("[data-cy='l3-stickybar']");
    expect(await bar.isVisible(), "the sticky bar shows on a phone");
    expect.eq(await bar.locator("a").count(), 2, "two buttons on the bar");
    const scrollW = await page.evaluate(() =>
      document.documentElement.scrollWidth
    );
    expect(scrollW <= PHONE.width, `nothing wider than the phone (${scrollW})`);
  }));

Deno.test("REQ-148: the signup on /landing4 still sends the code and opens the account, the way /landing3 and /landing2 do", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing4");
    await expect.see("Empieza gratis hoy");
    expect.eq(
      await page.locator("#reg-consent").isChecked(),
      true,
      "the consent box is ticked when the page opens (REQ-097)",
    );
    await page.locator("#reg-phone").fill(`512${digits()}`);
    await page.locator("[data-cy='l2-send-code']").click();
    await expect.see("Te mandamos un código de 6 dígitos");
    await page.locator("#reg-code").fill("000000");
    await page.waitForURL((u: URL) => u.pathname !== "/landing4", {
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle");
    const landed = new URL(page.url()).pathname;
    expect(
      landed !== "/login" && landed !== "/landing4",
      `signed in and inside the app (${landed})`,
    );
  }));
