import { type Lang, tFor } from "../lib/i18n.ts";
import { TERMS_PATH } from "../../shared/legal/terms.ts";

/**
 * REQ-043 — the site footer every page ends with: a "Terms of Service" link
 * to /terms. Styled inline so it drops into every shell (the landing footers,
 * the login/verify card, the dashboard `.content` scroll, the public
 * documents, the assistant page, the error page) without touching their
 * stylesheets. Kept to 30px tall on purpose (3px + a 24px tap box + 3px): the assistant shell's `.main`
 * is overflow:hidden with 32px of slack under `.asst`.
 */
export default function SiteFooter(
  { lang = "en", style = "" }: { lang?: Lang; style?: string },
) {
  return (
    <footer
      class="site-footer"
      data-site-footer
      style={`text-align:center;font-size:12px;line-height:18px;padding:3px 12px;color:#8a9699;flex-shrink:0;${style}`}
    >
      <a
        href={TERMS_PATH}
        data-terms-link
        style="display:inline-block;min-height:24px;padding:5px 8px;line-height:14px;color:inherit;text-decoration:underline;text-underline-offset:2px"
      >
        {tFor(lang, "siteFooter.terms")}
      </a>
    </footer>
  );
}
