/**
 * PublicLangToggle — the EN | ES switch above a server-rendered public
 * document (REQ-272: the invoice at /i/:id; REQ-048 gave /q its own).
 *
 * Each choice is a plain link to the same page with ?lang= set, so it works
 * before hydration and without JavaScript: the route reads ?lang= first
 * (resolvePublicLang). Once hydrated, a tap also persists the pick (pm_lang
 * cookie + localStorage) so a plain visit to the link later opens in the
 * language the customer chose.
 */
import { type Lang, tFor } from "../lib/i18n.ts";
import { persistLang } from "../lib/lang.ts";

export default function PublicLangToggle(
  { lang, hrefs }: {
    /** The language the page was rendered in. */
    lang: Lang;
    /** The same page with ?lang=en / ?lang=es (langToggleHref). */
    hrefs: Record<Lang, string>;
  },
) {
  return (
    <nav
      class="pub-lang"
      data-cy="public-lang-toggle"
      aria-label={tFor(lang, "quoteDoc.langToggleAria")}
    >
      {(["en", "es"] as Lang[]).map((l) => (
        <a
          key={l}
          href={hrefs[l]}
          hreflang={l}
          data-public-lang={l}
          aria-current={lang === l ? "true" : "false"}
          class={lang === l ? "on" : ""}
          onClick={() => persistLang(l)}
        >
          {l.toUpperCase()}
        </a>
      ))}
    </nav>
  );
}
