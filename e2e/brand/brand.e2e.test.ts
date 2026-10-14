/**
 * REQ-071 — Raphael, 2026-10-14: "replace paperwork monster with DocuMonster
 * everywhere." The brand the visitor reads is DocuMonster: the header of the
 * website ("/", front-end/routes/index.tsx), the promo site ("/landing"), the
 * login card (login.tsx) and the contact page (contact.tsx) — the brand mark,
 * the browser title and the footer copyright — in English and in Spanish.
 * The old brand is nowhere on those pages; the one place its words remain is
 * the attorney's "DocuMonster Powered by Paperwork Monster" (REQ-065), which
 * the contact page's SMS consent box quotes.
 */
import { story, type StoryTools } from "#shots";

const KEPT = /DocuMonster Powered by Paperwork Monster/g;
const OLD_BRAND = /paperwork\s*monster/i;

async function setLang(page: StoryTools["page"], baseUrl: string, lang: "en" | "es") {
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([{ name: "pm_lang", value: lang, domain: host, path: "/" }]);
}

/** the brand mark in the page's header: one word, DocuMonster */
async function brandText(page: StoryTools["page"], selector: string): Promise<string> {
  const brand = page.locator(selector).first();
  await brand.waitFor({ timeout: 15000 });
  return (await brand.innerText()).replace(/\s+/g, " ").trim();
}

const PAGES = [
  { path: "/", brand: ".brand", footer: "footer" },
  { path: "/landing", brand: ".pm-brand", footer: "footer" },
  { path: "/login", brand: ".brand", footer: "[data-site-footer]" },
  { path: "/contact", brand: ".brand", footer: "[data-site-footer]" },
] as const;

Deno.test("REQ-071: the brand reads DocuMonster on the website, the login card and the contact page — header, browser title, footer — in both languages", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    for (const lang of ["en", "es"] as const) {
      await setLang(page, baseUrl, lang);
      for (const p of PAGES) {
        await page.goto(p.path);
        const where = `${p.path} (${lang})`;
        expect.eq(await brandText(page, p.brand), "DocuMonster", `${where}: the brand in the header is the one word`);
        const title = await page.title();
        expect(title.includes("DocuMonster"), `${where}: the browser title names DocuMonster — "${title}"`);
        expect(!OLD_BRAND.test(title), `${where}: the browser title no longer says Paperwork Monster — "${title}"`);
        // the footer into the frame — the copyright line names the brand
        const footer = page.locator(p.footer).last();
        await footer.scrollIntoViewIfNeeded();
        const footerText = (await footer.innerText()).replace(/\s+/g, " ");
        if (p.path === "/" || p.path === "/landing") {
          expect(/© 2026 DocuMonster\./.test(footerText), `${where}: the footer copyright is "© 2026 DocuMonster." — "${footerText.slice(0, 80)}"`);
        }
        // nowhere on the page, outside the attorney's d/b/a
        const body = (await page.locator("body").innerText()).replace(KEPT, "");
        const hit = body.match(/.{0,40}paperwork\s*monster.{0,40}/i)?.[0];
        expect(hit === undefined, `${where}: the old brand is nowhere on the page — "${hit ?? ""}"`);
      }
    }
    // the website's language toggle rewrites the header in place: the brand stays the one word
    await setLang(page, baseUrl, "en");
    await page.goto("/");
    await page.locator(".lang-toggle button[data-lang='es']").click();
    expect.eq(await brandText(page, ".brand"), "DocuMonster", "/ after the toggle: the brand in the header is still the one word");
    await expect.see("DocuMonster");
  }));
