import { type Lang, tFor } from "../lib/i18n.ts";
import { LEGAL_LINKS } from "../../shared/legal/terms.ts";
import SiteFooterLive from "../islands/SiteFooterLive.tsx";
import type { SiteFooterCopy } from "./SiteFooterView.tsx";

/** REQ-367 — the footer's words in `lang`: the grid's label and the four policy links, from the one list. */
export function siteFooterCopy(lang: Lang): SiteFooterCopy {
  return {
    policiesAria: tFor(lang, "siteFooter.policiesAria"),
    links: LEGAL_LINKS.map((l) => ({
      id: l.id,
      path: l.path,
      label: tFor(lang, l.labelKey),
    })),
  };
}

/**
 * REQ-043 — the site footer every page ends with (its shape and placement:
 * components/SiteFooterView.tsx).
 *
 * REQ-367 (demo-loop cycle 1, m10): it follows the EN/ES switch on every page.
 * It used to be a server component rendered once in the request's language, so
 * on 30 routes the topbar's toggle (and the settings select, the onboarding
 * wizard, the contract's own EN | ES) left it in the old language until a
 * reload — REQ-269 had fixed /admin alone, with an island the other pages never
 * used. Now the one footer IS that island: pages render `<SiteFooter
 * lang={lang} />` as before, and it mounts SiteFooterLive with both languages'
 * words, which paints the SSR language first (hydration matches) and then
 * every switch. The words travel as props, so the browser loads no dictionary
 * for the footer.
 *
 * REQ-425 (demo-loop cycle 2, p6): the signed-in app routes pass `compact` —
 * the same links, phone and address on one line, so the footer no
 * longer takes 120-150 px from the chat, the in-chat calendar and the panes.
 * The public pages (login, the customer documents, the error page…) keep the
 * full block.
 */
export default function SiteFooter(
  { lang = "en", compact = false }: { lang?: Lang; compact?: boolean },
) {
  return (
    <SiteFooterLive
      lang={lang}
      compact={compact}
      copy={{ en: siteFooterCopy("en"), es: siteFooterCopy("es") }}
    />
  );
}
