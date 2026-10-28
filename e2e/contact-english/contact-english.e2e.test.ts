/**
 * REQ-122 — RingCentral's TCR reviewer (case 32804924, emails of 2026-10-20/21, forwarded by
 * Hans on 2026-10-22): the policy links opened in Spanish — "submit the direct URL parameter for
 * the English view (https://documonster.com/privacy?lang=en and
 * https://documonster.com/sms-terms?lang=en)"; "If using the web form at
 * https://documonster.com/contact, please remove the phone number reference." Raphael,
 * 2026-10-27: "fix the code only fixes".
 *
 * Found: /contact read only the cookie, never ?lang=, so /contact?lang=en was the Spanish form
 * for a reviewer with no saved language; the consent sentence said "Reply HELP to 855-362-8666"
 * — HELP is a keyword replied to the texting number, not a voice line; and the app shell labelled
 * a Spanish page <html lang="en"> whenever the browser asked for English, because the shell
 * followed Accept-Language while the page (Spanish-first, REQ-043 amendment) ignored it.
 *
 * Pages: front-end/routes/contact.tsx (the ContactForm island), privacy.tsx, sms-terms.tsx —
 * all on front-end/lib/public-page.ts, the one GET handler — and routes/_app.tsx.
 */
import { story, type StoryTools } from "#shots";

type Page = StoryTools["page"];

/** any spelling of a phone number: the support line, or ten digits in three groups */
const PHONE = /855|362|8666|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/;

const htmlLang = async (page: Page) => await page.locator("html").getAttribute("lang");

/** a visitor with no saved language: no pm_lang cookie AND no pm:lang in storage — a pick the
 *  page stored is mirrored back into the cookie on the next load (lib/lang.ts), so clearing the
 *  cookie alone would not forget it */
async function forget(page: Page) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch { /* about:blank has no storage */ }
  });
}

/** the consent box's whole sentence, as a person reads it */
async function consentText(page: Page): Promise<string> {
  const label = page.locator("[data-cy='contact-sms-consent-label']");
  await label.waitFor({ timeout: 15000 });
  return (await label.innerText()).replace(/\s+/g, " ").trim();
}

/** the server's own <html lang> for a path — before any island runs */
async function ssrLang(http: StoryTools["http"], path: string, acceptLanguage: string): Promise<string> {
  const r = await http(path, { headers: { "accept-language": acceptLanguage } });
  const html = await r.text();
  return html.match(/<html lang="([a-z]+)"/)?.[1] ?? "";
}

Deno.test("REQ-122: /contact?lang=en is the English form for a visitor with no saved language — the consent sentence says Reply HELP for assistance and names no phone number — the pick sticks on /contact, ?lang=es flips it back, and a bare /contact on an English browser stays Spanish-first, labelled Spanish", (t) =>
  story(t, async ({ page, expect, http }) => {
    await forget(page);
    // the link a reviewer follows: English, labelled English, with every disclosure and no number
    await page.goto("/contact?lang=en");
    await expect.see("Get in touch");
    expect.eq(await htmlLang(page), "en", "/contact?lang=en is labelled English");
    const en = await consentText(page);
    expect(en.includes("By checking this box, you agree to receive SMS messages from DocuMonster Powered by Paperwork Monster"), `the English consent sentence (${en})`);
    expect(en.includes("You may reply STOP to opt out at any time. Reply HELP for assistance. Messages and data rates may apply. Message frequency will vary."), `STOP, HELP, rates and frequency, no number (${en})`);
    expect(!PHONE.test(en), `the consent sentence names no phone number (${en})`);
    expect.eq(await page.locator("[data-cy='contact-sms-privacy']").getAttribute("href"), "/privacy", "the consent text links the Privacy Policy");
    expect.eq(await page.locator("[data-cy='contact-sms-terms']").getAttribute("href"), "/sms-terms", "the consent text links the SMS Terms");
    // the pick sticks: the bare path is English now
    await page.goto("/contact");
    await expect.see("Get in touch");
    expect.eq(await htmlLang(page), "en", "the pick persisted — /contact is English for this visitor");
    // and flips back to Spanish — the same sentence, the same disclosures, no number
    await page.goto("/contact?lang=es");
    await expect.see("Ponte en contacto");
    expect.eq(await htmlLang(page), "es", "/contact?lang=es is labelled Spanish");
    const es = await consentText(page);
    expect(es.includes("Puede responder STOP en cualquier momento para darse de baja. Responda HELP para obtener ayuda. Pueden aplicarse tarifas de mensajes y datos. La frecuencia de los mensajes variará."), `the Spanish consent sentence (${es})`);
    expect(!PHONE.test(es), `the Spanish consent sentence names no phone number (${es})`);
    // no saved language, an English browser: Spanish-first stands — and the label says so
    await forget(page);
    await page.goto("/contact");
    await expect.see("Ponte en contacto");
    expect.eq(await htmlLang(page), "es", "a Spanish page is labelled Spanish, whatever the browser asks for");
    expect.eq(await ssrLang(http, "/contact", "en-US,en;q=0.9"), "es", "the server itself labels the Spanish form Spanish for an English browser");
  }));

Deno.test("REQ-122: the two links the TCR submission names open the English documents, labelled English, for a visitor with no saved language — and the bare links stay Spanish, labelled Spanish", (t) =>
  story(t, async ({ page, expect, http }) => {
    await forget(page);
    await page.goto("/privacy?lang=en");
    await expect.see("Last Updated: October 6, 2026");
    await expect.see("Mobile opt-in information and SMS consent are not sold, rented, released, or shared with third parties or affiliates for their own marketing or promotional purposes.");
    expect.eq(await htmlLang(page), "en", "/privacy?lang=en is labelled English");
    await forget(page);
    await page.goto("/sms-terms?lang=en");
    await expect.see("A recipient may opt out of an applicable SMS program at any time by replying STOP.");
    await expect.see("Message and data rates may apply depending on the recipient's wireless plan and carrier.");
    expect.eq(await htmlLang(page), "en", "/sms-terms?lang=en is labelled English");
    // the bare links on an English browser with no saved language: Spanish, and labelled so
    await forget(page);
    await page.goto("/privacy");
    await expect.see("Política de privacidad");
    expect.eq(await htmlLang(page), "es", "a bare /privacy is Spanish-first, labelled Spanish");
    await page.goto("/sms-terms");
    await expect.see("Términos y condiciones de SMS");
    expect.eq(await htmlLang(page), "es", "a bare /sms-terms is Spanish-first, labelled Spanish");
    expect.eq(await ssrLang(http, "/privacy", "en-US,en;q=0.9"), "es", "the server itself labels the Spanish policy Spanish for an English browser");
    expect.eq(await ssrLang(http, "/privacy?lang=en", "es-MX,es;q=0.9"), "en", "and the English link English for a Spanish browser");
  }));
