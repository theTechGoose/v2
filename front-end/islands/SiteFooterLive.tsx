/**
 * REQ-269 (demo i18n-formatting-m2) — the SiteFooter, live. SiteFooter is a
 * server component: it renders once with the SSR language, so on /admin the
 * topbar's EN/ES toggle flipped the page and left the footer in the old
 * language until a reload. This island renders the same footer with the SSR
 * language first (hydration matches) and then follows `langSignal`.
 */
import { useEffect, useState } from "preact/hooks";
import SiteFooter from "../components/SiteFooter.tsx";
import type { Lang } from "../lib/lang.ts";
import { liveLang } from "../lib/live-lang.ts";

export default function SiteFooterLive({ lang }: { lang: Lang }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return <SiteFooter lang={liveLang(hydrated, lang)} />;
}
