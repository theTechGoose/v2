import { type Lang, tFor } from "../lib/i18n.ts";
import { LEGAL_LINKS } from "../../shared/legal/terms.ts";
import SiteFooterLive from "../islands/SiteFooterLive.tsx";
import type { SiteFooterCopy } from "./SiteFooterView.tsx";

/** REQ-367 — the footer's words in `lang`: the grid's label and the four policy links, from the one list (REQ-509: and the document footer's "Powered by DocuMonster"). */
export function siteFooterCopy(lang: Lang): SiteFooterCopy {
  return {
    policiesAria: tFor(lang, "siteFooter.policiesAria"),
    poweredBy: tFor(lang, "siteFooter.poweredBy"),
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
 * The public pages (login, the error page…) keep the full block.
 *
 * REQ-509 (demo-loop cycle 3, m24): the contractor's public documents — the
 * quote /q, the invoice /i, the change order /co — pass `document`: the four
 * policy links and "Powered by DocuMonster", no DocuMonster phone or address
 * under the contractor's own contact block.
 */
export default function SiteFooter(
  {
    lang = "en",
    compact = false,
    document: forDocument = false,
    credited = false,
  }: {
    lang?: Lang;
    compact?: boolean;
    /** REQ-509: the footer of the contractor's customer documents */
    document?: boolean;
    /**
     * REQ-573 (cycle 4, p4-p3c): the document's body already ends with
     * "Powered by DocuMonster · …" (/q, /i), so the footer drops its credit
     */
    credited?: boolean;
  },
) {
  return (
    <SiteFooterLive
      lang={lang}
      compact={compact}
      document={forDocument}
      credited={credited}
      copy={{ en: siteFooterCopy("en"), es: siteFooterCopy("es") }}
    />
  );
}
