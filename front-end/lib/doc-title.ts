import type { Lang } from "./lang.ts";

/**
 * REQ-367 (demo-loop cycle 1, m10) — the tab title follows the EN/ES switch.
 * Every page wrote its <title> once, at SSR, in the request's language, and
 * nothing ever updated document.title, so after a switch the tab kept the old
 * language ("Clientes · DocuMonster" over an English /customers). A page's
 * title is now a DocTitle (components/DocTitle.tsx): the SSR language's text,
 * plus each language's on the element itself, so the shell's HtmlLang island
 * can set the tab title on every switch without a dictionary.
 */

/** the attribute a DocTitle carries `lang`'s title in */
export function titleAttr(lang: Lang): string {
  return `data-title-${lang}`;
}

interface TitleDoc {
  querySelector(selectors: string): {
    getAttribute(name: string): string | null;
  } | null;
}

/** `lang`'s title, read off the page's DocTitle; null when the title is not a live one (a landing's own, a dev page's) */
export function liveTitle(doc: TitleDoc, lang: Lang): string | null {
  return doc.querySelector("title")?.getAttribute(titleAttr(lang)) ?? null;
}

/** set the tab title to `lang`'s — a title that is not live is left as it is */
export function followTitle(doc: TitleDoc & { title: string }, lang: Lang) {
  const next = liveTitle(doc, lang);
  if (next !== null && doc.title !== next) doc.title = next;
}
