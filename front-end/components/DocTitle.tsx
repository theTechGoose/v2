import type { Lang } from "../lib/lang.ts";
import { titleAttr } from "../lib/doc-title.ts";

/**
 * REQ-367 (demo-loop cycle 1, m10) — a page's <title>, live: it paints the SSR
 * language and carries every language's title (`data-title-en` /
 * `data-title-es`), so the app shell's HtmlLang island sets the tab title on
 * every EN/ES switch (lib/doc-title.ts). Inside the page's <Head>:
 *
 *   <DocTitle lang={lang} title={(l) => tFor(l, "quotesPage.docTitle")} />
 *
 * `title` builds one language's title from ITS argument — never from the page's
 * SSR `lang`, or both languages would carry the same text.
 */
export default function DocTitle(
  { lang, title }: { lang: Lang; title: (lang: Lang) => string },
) {
  const attrs = {
    [titleAttr("en")]: title("en"),
    [titleAttr("es")]: title("es"),
  };
  return <title {...attrs}>{title(lang)}</title>;
}
