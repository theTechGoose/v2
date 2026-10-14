/**
 * Hans Pedersen's request (email of 2026-10-05, forwarded by Raphael):
 * REQ-065 — "we have updated everything in this document to DocuMosnter Powered by Paperwork Monster … See attached" — the October 6, 2026 text, with the SMS Terms & Conditions.
 * REQ-066 — "each one on its own separate page and linked in the footer" (Sep 24) and "Make the
 * page that houses this information make the header look the same as the rest of the website".
 * REQ-067 — "we need these hyper links: Terms of Service | Refund & Cancellation Policy |
 * Privacy Policy | SMS Terms & Conditions — Every page of the websites · On the Contact us page
 * inquiry page · Footer of DocuMonster software" — and Raphael, 2026-10-09: "it needs to be one
 * link with a page that has multiple tabs": every footer carries ONE "Terms & Policies" link to
 * the policies page, whose tabs are the four.
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

/** bring a footer into the frame: a click on its address text (not a control) scrolls it into
 *  view, and the runner stamps a frame after every click — the judge's reviewer reads frames */
async function lookAtFooter(page: StoryTools["page"], footer: string) {
  await page.locator(`${footer} [data-site-address]`).first().click();
}

/** the ONE policies link inside a footer: [href, label] — and there is exactly one */
async function footerLegalLink(page: StoryTools["page"], footer: string): Promise<[string, string, number]> {
  const link = page.locator(`${footer} a[data-legal-footer-link]`);
  await link.first().waitFor({ timeout: 15000 });
  return [(await link.first().getAttribute("href")) ?? "", ((await link.first().innerText()) ?? "").trim(), await link.count()];
}

function expectOneLink(expect: StoryTools["expect"], where: string, link: [string, string, number]) {
  expect.eq(JSON.stringify(link), JSON.stringify(["/terms", "Terms & Policies", 1]), `${where}: one "Terms & Policies" link to the policies page`);
}

/** the four tabs on the policies page, in order: [href, label] */
async function tabs(page: StoryTools["page"]): Promise<[string, string][]> {
  const t = page.locator("[data-legal-nav] a[data-legal-link]");
  await t.first().waitFor({ timeout: 15000 });
  const n = await t.count();
  const out: [string, string][] = [];
  for (let i = 0; i < n; i++) out.push([(await t.nth(i).getAttribute("href")) ?? "", ((await t.nth(i).innerText()) ?? "").trim()]);
  return out;
}

Deno.test("REQ-066: each policy is its own page with the website's header, and the pages link to each other", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    await english(page, baseUrl);
    for (const p of PAGES) {
      await page.goto(p.path);
      // the website's header: the brand, the language toggle, the nav links and the Log in button
      const header = page.locator(".nav-wrap .nav");
      await header.waitFor({ timeout: 15000 });
      expect((await header.locator(".brand").innerText()).replace(/\s+/g, " ").trim() === "DocuMonster", `${p.path}: the brand in the header`);
      expect(await header.locator(".lang-toggle").count() === 1, `${p.path}: the language toggle in the header`);
      expect.eq((await header.locator(".nav-links a").allInnerTexts()).join("|"), "What We Do|How It Works|Pricing", `${p.path}: the website's nav links`);
      expect.eq(await header.locator("a.btn-outline").getAttribute("href"), "/login", `${p.path}: the Log in button`);
      // this one document, the October 6 text
      // innerText reads the stylesheet's uppercase; the markup is the title as written
      expect.eq((await page.locator(".legal__doc h1").allTextContents()).join("|"), p.title, `${p.path}: one document, its own`);
      await expect.see("Last Updated: October 6, 2026");
      if (p.path !== "/refund-policy") await expect.see("doing business as DocuMonster Powered by Paperwork Monster");
      // the four documents as tabs, this one current
      expect.eq(JSON.stringify(await tabs(page)), JSON.stringify(PAGES.map((q) => [q.path, q.title])), `${p.path}: the four tabs, in Hans's order`);
      expect.eq(await page.locator(`[data-legal-nav] a[aria-current="page"]`).getAttribute("href"), p.path, `${p.path}: the current tab`);
      // and the site footer with its one policies link — in the frame
      await lookAtFooter(page, "[data-site-footer]");
      expectOneLink(expect, p.path, await footerLegalLink(page, "[data-site-footer]"));
    }
    // a tab opens the next document
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
    // the tabs in Spanish (the long labels), wide and narrow: one row on a desktop, a 2×2 grid on
    // a narrow window, one column on a phone — every tab FULLY in view, nothing clipped, nothing
    // to scroll, the current one filled ("can you do this?" — the pill wrapped; then "why cant
    // you think about the ux" — the pill cut off at the edge of a phone)
    for (const [w, h, rows] of [[1440, 900, 1], [830, 900, 2], [390, 844, 4]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/sms-terms");
      const boxes = await page.locator("[data-legal-nav] a").evaluateAll((els: Element[]) => els.map((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), w: window.innerWidth }; }));
      expect(boxes.length === 4, `${w}px: four tabs`);
      expect.eq(new Set(boxes.map((b: { top: number }) => b.top)).size, rows, `${w}px: the tabs sit in ${rows} row(s)`);
      expect(boxes.every((b: { left: number; right: number; w: number }) => b.left >= 0 && b.right <= b.w), `${w}px: every tab is fully inside the window (${JSON.stringify(boxes)})`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(over, `${w}px: the page does not scroll sideways`);
      const bar = await page.locator("[data-legal-nav]").evaluate((e: Element) => e.scrollWidth <= e.clientWidth + 1);
      expect(bar, `${w}px: the tab bar itself has nothing hidden to scroll to`);
      const fill = await page.locator("[data-legal-nav] a.on").evaluate((e: Element) => getComputedStyle(e).backgroundColor);
      expect(fill === "rgb(26, 83, 92)", `${w}px: the current tab is filled teal (${fill})`);
    }
  }));

Deno.test("REQ-067: one policies link in the footer of both websites, the contact page, and the DocuMonster software, to the page whose tabs are the four", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await english(page, baseUrl);
    // the website
    await page.goto("/");
    await lookAtFooter(page, "footer.footer");
    expectOneLink(expect, "/", await footerLegalLink(page, "footer.footer"));
    // the promo website
    await page.goto("/landing");
    await lookAtFooter(page, "footer.pm-footer");
    expectOneLink(expect, "/landing", await footerLegalLink(page, "footer.pm-footer"));
    // the contact page
    await page.goto("/contact");
    await lookAtFooter(page, "[data-site-footer]");
    expectOneLink(expect, "/contact", await footerLegalLink(page, "[data-site-footer]"));
    // the DocuMonster software: signed in, the dashboard and the settings page
    await signIn(http, page, baseUrl);
    await page.goto("/dashboard");
    await lookAtFooter(page, "[data-site-footer]");
    expectOneLink(expect, "/dashboard", await footerLegalLink(page, "[data-site-footer]"));
    await page.goto("/settings");
    await lookAtFooter(page, "[data-site-footer]");
    expectOneLink(expect, "/settings", await footerLegalLink(page, "[data-site-footer]"));
    // the link opens the policies page, and its tabs are Hans's four
    await page.locator("[data-site-footer] a[data-legal-footer-link]").click();
    await page.waitForURL((u: URL) => u.pathname === "/terms", { timeout: 15000 });
    expect.eq(JSON.stringify(await tabs(page)), JSON.stringify(PAGES.map((q) => [q.path, q.title])), "the four tabs, in Hans's order");
    await page.locator("[data-legal-nav] a[data-legal-link='refunds']").click();
    await page.waitForURL((u: URL) => u.pathname === "/refund-policy", { timeout: 15000 });
    await expect.see("No Prorated Refunds");
  }));

Deno.test("REQ-068: the contact form carries a phone and an unchecked SMS consent box, and a consented inquiry goes through", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    await english(page, baseUrl);
    await page.goto("/contact");
    const consent = page.locator("input[data-cy='contact-sms-consent']");
    await consent.waitFor({ timeout: 15000 });
    // bring the box into the frame as it starts: a click on the message field scrolls there
    await page.locator("textarea").click();
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
Deno.test("REQ-067: the footers stay small and rounded — the contact card's strip is a few rows, and the website's links wrap instead of running off a phone", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    await english(page, baseUrl);
    // desktop: the strip under the contact form is three rows at most (24px each, plus 4px)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/contact");
    const strip = page.locator("[data-site-footer]");
    await strip.waitFor({ timeout: 15000 });
    await lookAtFooter(page, "[data-site-footer]");
    let box = (await strip.boundingBox())!;
    expect(box.height <= 60, `desktop contact footer strip is ${box.height}px tall (≤ 60: two rows)`);
    // rounded like the card ("rounded corners to speak the design language of the app")
    const radius = await strip.evaluate((el: Element) => getComputedStyle(el).borderTopLeftRadius);
    expect.eq(radius, "16px", "the strip's corners are the app's --radius-lg");
    // phone: five rows at most, every item on one line
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/contact");
    await strip.waitFor({ timeout: 15000 });
    await lookAtFooter(page, "[data-site-footer]");
    box = (await strip.boundingBox())!;
    expect(box.height <= 90, `phone contact footer strip is ${box.height}px tall (≤ 90: three rows)`);
    const rows = await strip.locator("a, span").evaluateAll((els: Element[]) => els.map((e) => (e as HTMLElement).getBoundingClientRect().height));
    expect(rows.every((h: number) => h <= 26), `every footer item is one line (${rows.join(",")})`);
    // the website on a phone: the footer links wrap between links; nothing runs off the screen
    await page.goto("/");
    const links = page.locator("footer.footer .links");
    await links.waitFor({ timeout: 15000 });
    await lookAtFooter(page, "footer.footer");
    const over = await links.evaluate((el: Element) => ({ scroll: el.scrollWidth, client: el.clientWidth, page: document.documentElement.scrollWidth, vw: window.innerWidth }));
    expect(over.scroll <= over.client, `the links do not overflow their row (${over.scroll} > ${over.client})`);
    expect(over.page <= over.vw, `the page does not scroll sideways (${over.page} > ${over.vw})`);
    const heights = await links.locator("a").evaluateAll((els: Element[]) => els.map((e) => (e as HTMLElement).getBoundingClientRect().height));
    expect(heights.length === 5 && heights.every((h: number) => h <= 26), `each of the 5 links is one line (${heights.join(",")})`);
  }));
