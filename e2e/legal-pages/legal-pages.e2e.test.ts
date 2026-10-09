/**
 * Hans Pedersen's request (email of 2026-10-05, forwarded by Raphael):
 * REQ-065 — "we have updated everything in this document to DocuMosnter Powered by Paperwork
 * Monster … See attached" — the October 6, 2026 text, with the SMS Terms & Conditions.
 * REQ-066 — "each one on its own separate page and linked in the footer" (Sep 24) and "Make the
 * page that houses this information make the header look the same as the rest of the website".
 * REQ-067 — "we need these hyper links: Terms of Service | Refund & Cancellation Policy |
 * Privacy Policy | SMS Terms & Conditions — Every page of the websites · On the Contact us page
 * inquiry page · Footer of DocuMonster software".
 * REQ-068 — "Attached is the example for the contact us page as well" — the unchecked SMS
 * consent box with STOP / HELP and the policy links.
 *
 * Pages: front-end/routes/terms.tsx, refund-policy.tsx, privacy.tsx, sms-terms.tsx (one shared
 * front-end/components/LegalPage.tsx under the website's header), the SiteFooter every app page
 * ends with (front-end/components/SiteFooter.tsx), the two websites ("/" index.tsx, "/landing"
 * landing.tsx) and /contact with its ContactForm island.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

const PAGES = [
  { path: "/terms", title: "Terms of Service" },
  { path: "/refund-policy", title: "Refund & Cancellation Policy" },
  { path: "/privacy", title: "Privacy Policy" },
  { path: "/sms-terms", title: "SMS Terms & Conditions" },
] as const;

/** English on this browser: the public pages are Spanish-first (REQ-002) */
async function english(page: StoryTools["page"], baseUrl: string) {
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([{ name: "pm_lang", value: "en", domain: host, path: "/" }]);
}

/** A signed-in, onboarded account on the page's browser context (English). */
async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
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
  for (const [path, payload] of [
    ["/api/me", { name: "Footer Reader", language: "en" }],
    ["/api/profile/identity", { businessName: "Footer Reader LLC" }],
  ] as const) {
    const res = await http(path, { method: "PUT", headers: auth, body: JSON.stringify(payload) });
    await res.body?.cancel();
  }
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** the four policy links inside one footer, in order: [href, label] */
async function footerLinks(page: StoryTools["page"], footer: string): Promise<[string, string][]> {
  const links = page.locator(`${footer} a[data-legal-link]`);
  await links.first().waitFor({ timeout: 15000 });
  const n = await links.count();
  const out: [string, string][] = [];
  for (let i = 0; i < n; i++) {
    out.push([(await links.nth(i).getAttribute("href")) ?? "", ((await links.nth(i).innerText()) ?? "").trim()]);
  }
  return out;
}

function expectFourLinks(expect: StoryTools["expect"], where: string, links: [string, string][]) {
  expect.eq(JSON.stringify(links), JSON.stringify(PAGES.map((p) => [p.path, p.title])), `${where}: the four policy links, in Hans's order`);
}

Deno.test("REQ-066: each policy is its own page with the website's header, and the pages link to each other", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    await english(page, baseUrl);
    for (const p of PAGES) {
      await page.goto(p.path);
      // the website's header: the brand, the language toggle, the nav links and the Log in button
      const header = page.locator(".nav-wrap .nav");
      await header.waitFor({ timeout: 15000 });
      expect((await header.locator(".brand").innerText()).replace(/\s+/g, " ").trim() === "Paperwork Monster", `${p.path}: the brand in the header`);
      expect(await header.locator(".lang-toggle").count() === 1, `${p.path}: the language toggle in the header`);
      expect.eq((await header.locator(".nav-links a").allInnerTexts()).join("|"), "What We Do|How It Works|Pricing", `${p.path}: the website's nav links`);
      expect.eq(await header.locator("a.btn-outline").getAttribute("href"), "/login", `${p.path}: the Log in button`);
      // this one document, the October 6 text
      // innerText reads the stylesheet's uppercase; the markup is the title as written
      expect.eq((await page.locator(".legal__doc h1").allTextContents()).join("|"), p.title, `${p.path}: one document, its own`);
      await expect.see("Last Updated: October 6, 2026");
      if (p.path !== "/refund-policy") await expect.see("doing business as DocuMonster Powered by Paperwork Monster");
      // the row of the four documents, this one current
      const nav = page.locator("[data-legal-nav] a");
      expect.eq(await nav.count(), 4, `${p.path}: the four documents named`);
      expect.eq(await page.locator(`[data-legal-nav] a[aria-current="page"]`).getAttribute("href"), p.path, `${p.path}: marked current`);
      // and the site footer with the four links
      expectFourLinks(expect, p.path, await footerLinks(page, "[data-site-footer]"));
    }
    // the row walks to the next document
    await page.goto("/terms");
    await page.locator("[data-legal-nav] a[data-legal-link='sms']").click();
    await page.waitForURL((u: URL) => u.pathname === "/sms-terms", { timeout: 15000 });
    await expect.see("SMS Program Overview");
    await expect.see("A recipient may opt out of an applicable SMS program at any time by replying STOP.");
    // the toggle flips the page to Spanish, and the pick sticks
    await page.locator(".lang-toggle a[data-legal-lang='es']").click();
    await expect.see("Términos y condiciones de SMS");
    await expect.see("Última actualización: 6 de octubre de 2026");
    await page.goto("/privacy");
    await expect.see("Política de privacidad");
  }));

Deno.test("REQ-067: the four policy links are in the footer of both websites, the contact page, and the DocuMonster software", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await english(page, baseUrl);
    // the website
    await page.goto("/");
    expectFourLinks(expect, "/", await footerLinks(page, "footer.footer"));
    // the promo website
    await page.goto("/landing");
    expectFourLinks(expect, "/landing", await footerLinks(page, "footer.pm-footer"));
    // the contact page
    await page.goto("/contact");
    expectFourLinks(expect, "/contact", await footerLinks(page, "[data-site-footer]"));
    // the DocuMonster software: signed in, the dashboard and the settings page
    await signIn(http, page, baseUrl);
    await page.goto("/dashboard");
    expectFourLinks(expect, "/dashboard", await footerLinks(page, "[data-site-footer]"));
    await page.goto("/settings");
    expectFourLinks(expect, "/settings", await footerLinks(page, "[data-site-footer]"));
    // a link is a link: the software's footer opens the refund policy
    await page.locator("[data-site-footer] a[data-legal-link='refunds']").click();
    await page.waitForURL((u: URL) => u.pathname === "/refund-policy", { timeout: 15000 });
    await expect.see("Refund & Cancellation Policy");
    await expect.see("No Prorated Refunds");
  }));

Deno.test("REQ-068: the contact form carries a phone and an unchecked SMS consent box, and a consented inquiry goes through", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    await english(page, baseUrl);
    await page.goto("/contact");
    const consent = page.locator("input[data-cy='contact-sms-consent']");
    await consent.waitFor({ timeout: 15000 });
    expect(!(await consent.isChecked()), "the SMS consent box starts unchecked");
    expect(!(await consent.getAttribute("required")), "consent is never required");
    // Hans's example text, with the policy links
    await expect.see("By checking this box, you agree to receive SMS messages from DocuMonster Powered by Paperwork Monster");
    await expect.see("You may reply STOP to opt out at any time. Reply HELP to 855-362-8666 for assistance. Messages and data rates may apply. Message frequency will vary.");
    expect.eq(await page.locator("[data-cy='contact-sms-privacy']").getAttribute("href"), "/privacy", "the consent text links the Privacy Policy");
    expect.eq(await page.locator("[data-cy='contact-sms-terms']").getAttribute("href"), "/sms-terms", "the consent text links the SMS Terms");
    // the inquiry, with a phone and consent
    await page.locator("input[autocomplete='name']").fill("Story Caller");
    await page.locator("input[type='email']").fill(`story-${digits()}@blackhole.postmarkapp.com`);
    await page.locator("input[type='tel']").fill("540-333-1334");
    await page.locator("input[data-cy='contact-subject']").fill("Texting");
    await page.locator("textarea").fill("Please text me back about a quote.");
    await consent.check();
    expect(await consent.isChecked(), "ticked by the person");
    await page.locator("button[type='submit']").click();
    await expect.see("Thanks — we got your message and we'll be in touch soon.");
  }));

// Raphael, 2026-10-09, on the first pin: "this looks like crap … the blue part has expanded
// into a huge thing, its spoosed to be a small thing." The blue part is the site footer inside
// the contact card (verify.css paints a footer teal): with four links it had grown to six rows
// on a phone; and the website's footer links, eight now, overflowed the phone's screen word by word.
Deno.test("REQ-067: the footers stay small — the contact card's strip is a few rows, and the website's links wrap instead of running off a phone", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    await english(page, baseUrl);
    // desktop: the strip under the contact form is three rows at most (24px each, plus 4px)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/contact");
    const strip = page.locator("[data-site-footer]");
    await strip.waitFor({ timeout: 15000 });
    let box = (await strip.boundingBox())!;
    expect(box.height <= 80, `desktop contact footer strip is ${box.height}px tall (≤ 80)`);
    // phone: five rows at most, every item on one line
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/contact");
    await strip.waitFor({ timeout: 15000 });
    box = (await strip.boundingBox())!;
    expect(box.height <= 130, `phone contact footer strip is ${box.height}px tall (≤ 130)`);
    const rows = await strip.locator("a, span").evaluateAll((els: Element[]) => els.map((e) => (e as HTMLElement).getBoundingClientRect().height));
    expect(rows.every((h: number) => h <= 26), `every footer item is one line (${rows.join(",")})`);
    // the website on a phone: the footer links wrap between links; nothing runs off the screen
    await page.goto("/");
    const links = page.locator("footer.footer .links");
    await links.waitFor({ timeout: 15000 });
    const over = await links.evaluate((el: Element) => ({ scroll: el.scrollWidth, client: el.clientWidth, page: document.documentElement.scrollWidth, vw: window.innerWidth }));
    expect(over.scroll <= over.client, `the links do not overflow their row (${over.scroll} > ${over.client})`);
    expect(over.page <= over.vw, `the page does not scroll sideways (${over.page} > ${over.vw})`);
    const heights = await links.locator("a").evaluateAll((els: Element[]) => els.map((e) => (e as HTMLElement).getBoundingClientRect().height));
    expect(heights.length === 8 && heights.every((h: number) => h <= 26), `each of the 8 links is one line (${heights.join(",")})`);
  }));
