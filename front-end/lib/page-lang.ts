import {
  type Lang,
  langFromCookie,
  pickLangFromAcceptLanguage,
} from "./lang.ts";

/**
 * REQ-122 — the ONE resolver of a public page's language, from its request.
 *
 * An explicit `?lang=en|es` wins and is the pick to persist (`picked`), then
 * the visitor's saved `pm_lang` (HTTP/2 comma-joined cookies included), then
 * the same Spanish-first default every public page uses — the browser's
 * Accept-Language is ignored on purpose (REQ-043 amendment,
 * pickLangFromAcceptLanguage). A `?lang=` that is no language falls through.
 *
 * Pure over the request: the public pages' GET handler (public-page.ts) reads
 * it for the page AND records it for the app shell, so what a page paints and
 * what `<html lang>` says can never drift apart.
 */
export interface PageLang {
  /** the language the page paints */
  lang: Lang;
  /** the explicit ?lang= pick to persist — null when the URL named none */
  picked: Lang | null;
}

export function resolvePageLang(
  req: Pick<Request, "url" | "headers">,
): PageLang {
  const q = new URL(req.url).searchParams.get("lang");
  const picked: Lang | null = q === "en" || q === "es" ? q : null;
  const lang: Lang = picked ??
    langFromCookie(req.headers.get("cookie")) ??
    pickLangFromAcceptLanguage(req.headers.get("accept-language"));
  return { lang, picked };
}
