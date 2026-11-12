/**
 * REQ-269 (demo i18n-formatting-m2) — the SiteFooter, live. SiteFooter used to
 * be a server component: it rendered once with the SSR language, so on /admin
 * the topbar's EN/ES toggle flipped the page and left the footer in the old
 * language until a reload.
 *
 * REQ-367 (demo-loop cycle 1, m10): this island IS the site footer on every
 * page (components/SiteFooter.tsx mounts it). It paints the SSR language first,
 * so hydration matches the server's markup, then follows every switch of the
 * app language (`langSignal`, through useLiveLang). Both languages' words
 * arrive as props, so this chunk carries no dictionary.
 */
import type { Lang } from "../lib/lang.ts";
import { useLiveLang } from "../lib/live-lang.ts";
import SiteFooterView, {
  type SiteFooterCopy,
} from "../components/SiteFooterView.tsx";

export default function SiteFooterLive(
  { lang, copy, compact = false, document: forDocument = false }: {
    lang: Lang;
    copy: Record<Lang, SiteFooterCopy>;
    /** REQ-425: the one-line footer of the signed-in app routes */
    compact?: boolean;
    /** REQ-509: the footer of the contractor's customer documents */
    document?: boolean;
  },
) {
  const shown = useLiveLang(lang);
  return (
    <SiteFooterView
      copy={copy[shown]}
      compact={compact}
      document={forDocument}
    />
  );
}
