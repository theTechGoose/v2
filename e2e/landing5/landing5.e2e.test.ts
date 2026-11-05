/**
 * REQ-149 — Raphael, 2026-11-05: "implement landing3 landing4 landing5. make sure all of the
 * buttons and ctas and everything works just as it works in landing 1 and 2." — /landing5 is the
 * "Landing v5" mock (landing-variations/v5, Nov 3): the simple one — try it free, 30 days of
 * Monster Assist, Sign up now to the app's sign-in, and a Need-help-we-call-you card.
 *
 * The page: front-end/routes/landing5.tsx (SSR, Spanish first, English on the toggle), its island
 * Landing5CallMe (name + cell → POST /demo-request, a call as soon as possible) and
 * front-end/static/landing5.css over landing2.css. The stories run on the fakes.
 */
import { story, type StoryTools } from "#shots";
import { LEGAL_LINKS } from "../../shared/legal/terms.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const INK = "rgb(21, 32, 43)";

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

function watchPosts(page: StoryTools["page"], path: string) {
  let n = 0;
  page.on("request", (req: { url(): string; method(): string }) => {
    if (req.method() === "POST" && req.url().includes(path)) n++;
  });
  return () => n;
}

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
      // the button is gone or not clickable yet
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-149: /landing5 is the v5 mock — Spanish first, English on the toggle, the ad follows ?ad=, Sign up now and Start free go to /login, Escríbenos is the email, the policy links land, and a phone shows the sticky bar", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing5");
    await expect.see(
      "Los cumpleaños son para esto. Del papeleo se encarga el monstruo.",
    );
    await expect.see("Pruébalo gratis hoy.");
    await expect.see(
      "Y los primeros 30 días, una persona real te hace el papeleo.",
    );
    await expect.see(
      "¿Necesitas ayuda? Te podemos llamar. Solo déjanos tus datos aquí abajo.",
    );
    await expect.see("¿Prefieres hablar? Llámanos al");
    await expect.see(
      "Personas reales que hablan español. Siete días a la semana.",
    );
    await expect.see("Queremos que conozcas a nuestro equipo.");
    await expect.see(
      "30 días de Monster Assist: te llamamos y lo armamos contigo y por ti",
    );
    await expect.see(
      "Deja el Papeleo al equipo Monstruo. Tú sigue en la obra y recupera tus noches y fines de semana.",
    );
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "es",
      "<html lang> is es",
    );
    // the sections in the mock's order
    const order = ["nav", "hero", "trust", "final", "footer"];
    let last = -1;
    for (const section of order) {
      expect.eq(
        await count(page, `[data-cy='l5-${section}']`),
        1,
        `the ${section} section is on the page`,
      );
      const y = await top(page, `[data-cy='l5-${section}']`);
      expect(
        y >= last,
        `${section} comes after the section before it (${y} ≥ ${last})`,
      );
      last = y;
    }
    expect.eq(
      await page.locator("[data-cy='l5-trust']").evaluate((el: HTMLElement) =>
        getComputedStyle(el).backgroundColor
      ),
      INK,
      "the trust section is an ink band",
    );
    // the photos: the ad and the four faces
    expect(
      await loaded(page, "[data-cy='l5-hero'] img[src^='/ad-cumple.jpg']"),
      "the ad photo loaded",
    );
    const faces = page.locator("[data-cy='l5-face'] img");
    expect.eq(await faces.count(), 4, "four faces");
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      names.push((await faces.nth(i).getAttribute("alt")) ?? "");
    }
    expect.eq(
      names.join(","),
      "Art,Ben,Keren,Sergio",
      "Art, Ben, Keren and Sergio, in the mock's order",
    );
    for (const who of ["art", "ben", "keren", "sergio"]) {
      expect(
        await loaded(page, `[data-cy='l5-face'] img[src^='/team-${who}.jpg']`),
        `${who}'s photo loaded`,
      );
    }
    await expect.notSee(["Powered by Paperwork", "Monster"].join(" ")); // the old brand (REQ-071)
    // Sign up now is the app's sign-in; so is Start free; Escríbenos is the email; Llámanos scrolls to the phone row
    expect.eq(
      await page.locator("[data-cy='l5-signup']").getAttribute("href"),
      "/login",
      "Regístrate ahora goes to /login",
    );
    const final = page.locator("[data-cy='l5-final']");
    expect.eq(
      await final.locator("a").count(),
      3,
      "three buttons in the closing",
    );
    expect.eq(
      await final.locator("a[href='/login']").count(),
      1,
      "Empezar gratis → /login",
    );
    expect.eq(
      await final.locator("a[href='#llamanos']").count(),
      1,
      "Llámanos → the phone row (REQ-092)",
    );
    expect.eq(
      await final.locator("a[href^='mailto:']").count(),
      1,
      "Escríbenos → the email",
    );
    expect.eq(
      await count(page, "#llamanos a[href='tel:+18553628666']"),
      1,
      "the phone row dials the line",
    );
    await final.locator("a[href='#llamanos']").click();
    expect(
      await page.locator("#llamanos").evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.top >= -2 && r.top < innerHeight;
      }),
      "Llámanos scrolls to the phone row",
    );
    // the policy links: the four, in order
    const legal = page.locator("[data-cy='l5-footer'] a[data-legal-link]");
    expect.eq(await legal.count(), LEGAL_LINKS.length, "the four policy links");
    for (let i = 0; i < LEGAL_LINKS.length; i++) {
      expect.eq(
        await legal.nth(i).getAttribute("href"),
        LEGAL_LINKS[i].path,
        `policy link ${i} is ${LEGAL_LINKS[i].path}`,
      );
    }
    // the ad follows ?ad=
    await page.goto("/landing5?ad=domingo");
    await expect.see(
      "Los domingos son para esto. Del papeleo se encarga el monstruo.",
    );
    expect.eq(
      await page.locator("[data-cy='l5-hero'] img[data-ad]").getAttribute(
        "data-ad",
      ),
      "domingo",
      "the ad is domingo",
    );
    // English on the toggle — one link
    expect.eq(await count(page, "[data-cy='l5-lang']"), 1, "one toggle");
    await page.locator("[data-cy='l5-lang']").click();
    await page.waitForURL((u: URL) => u.searchParams.get("lang") === "en");
    await expect.see(
      "Sundays are for this. The Monster handles the paperwork.",
    );
    await expect.see("Try it free today.");
    await expect.see("Sign up now");
    await expect.see(
      "Need help? We can call you. Just give us your information below.",
    );
    await expect.see("Real people speaking Spanish. Seven days a week.");
    await expect.see("Leave the Paperwork to the Monster team.");
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "<html lang> is en",
    );
    await expect.notSee("Pruébalo gratis hoy.");
    // Sign up now really lands on the sign-in
    await page.locator("[data-cy='l5-signup']").click();
    await page.waitForURL((u: URL) => u.pathname === "/login");
    // the phone: the sticky bar — sign up and call — nothing wider than the screen
    await page.setViewportSize(PHONE);
    await page.goto("/landing5?lang=es"); // the toggle left the cookie on en
    await expect.see("Pruébalo gratis hoy.");
    const bar = page.locator("[data-cy='l5-stickybar']");
    expect(await bar.isVisible(), "the sticky bar shows on a phone");
    const barBox = await bar.boundingBox();
    expect(
      !!barBox && Math.abs(barBox.y + barBox.height - PHONE.height) < 2,
      `the sticky bar sits at the bottom (${JSON.stringify(barBox)})`,
    );
    expect.eq(await bar.locator("a").count(), 2, "two buttons on the bar");
    expect.eq(
      await bar.locator("a[href='/login']").count(),
      1,
      "Regístrate ahora → /login",
    );
    expect.eq(
      await bar.locator("a[href='#llamanos']").count(),
      1,
      "Llámanos → the phone row",
    );
    const scrollW = await page.evaluate(() =>
      document.documentElement.scrollWidth
    );
    expect(scrollW <= PHONE.width, `nothing wider than the phone (${scrollW})`);
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing5");
    expect.eq(
      await page.locator("[data-cy='l5-stickybar']").isVisible(),
      false,
      "no sticky bar on a desktop",
    );
  }));

Deno.test("REQ-149: the call-me card works — the consent box is ticked when the page opens and holds the call while unticked, an empty send is answered on the page, then the name and the cell post the call and ¡Listo! shows", (t) =>
  story(t, async ({ page, expect }) => {
    const posts = watchPosts(page, "/demo-request");
    await page.setViewportSize(DESKTOP);
    await page.goto("/landing5");
    await expect.see("¿Necesitas ayuda? Te podemos llamar.");
    const consent = page.locator("#c-consent");
    expect.eq(
      await consent.isChecked(),
      true,
      "the consent box is ticked when the page opens (REQ-097)",
    );
    await expect.see("Acepto que DocuMonster me contacte por texto o llamada.");
    expect.eq(
      await page.locator("[data-cy='l5-callme'] a[href='/sms-terms']").count(),
      1,
      "the consent's Términos link goes to the SMS terms",
    );
    // empty: answered on the page, nothing posted
    await page.locator("[data-cy='l5-callme-send']").click();
    await expect.see("Escribe tu nombre.");
    expect.eq(posts(), 0, "nothing posted without a name");
    await page.locator("#c-name").fill("Ana López");
    await page.locator("[data-cy='l5-callme-send']").click();
    await expect.see("Escribe un celular válido.");
    expect.eq(posts(), 0, "nothing posted without a cell");
    // unticked: held on the page
    await page.locator("#c-phone").fill(`512${digits()}`);
    await consent.uncheck();
    await page.locator("[data-cy='l5-callme-send']").click();
    await expect.see("Marca la casilla para que podamos llamarte.");
    expect.eq(posts(), 0, "nothing posted without consent");
    // ticked again: the call is posted, ¡Listo!
    await consent.check();
    await clickUntil(
      page,
      "[data-cy='l5-callme-send']",
      async () => (await count(page, "[data-cy='l5-callme-done']")) > 0,
    );
    await expect.see("¡Listo!");
    await expect.see("Te llamamos hoy. Si es tarde, mañana a primera hora.");
    expect.eq(posts(), 1, "one POST /demo-request");
  }));
