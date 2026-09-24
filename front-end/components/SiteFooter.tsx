import { type Lang, tFor } from "../lib/i18n.ts";
import { TERMS_PATH } from "../../shared/legal/terms.ts";
import {
  BUSINESS_ADDRESS,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_HREF,
} from "../../shared/legal/contact.ts";

/**
 * REQ-043 — the site footer every page ends with: a "Terms of Service" link
 * to /terms. REQ-044 adds the support phone (a `tel:` link) and the business
 * mailing address on the same line. Styled inline so it drops into every
 * shell (the landing footers, the login/verify card, the dashboard
 * `.content` scroll, the public documents, the assistant page, the error
 * page) without touching their stylesheets.
 *
 * Height: one 30px line (3px + a 24px tap box + 3px) wherever the three
 * items fit side by side; on narrow screens they wrap to more lines, so the
 * assistant shell's `.asst` sizes itself to the space left (flex), not to a
 * fixed 30px (assistant-page.css).
 */
export default function SiteFooter(
  { lang = "en", style = "" }: { lang?: Lang; style?: string },
) {
  const item =
    "display:inline-block;min-height:24px;padding:5px 8px;line-height:14px;color:inherit;";
  return (
    <footer
      class="site-footer"
      data-site-footer
      style={`display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:0 4px;text-align:center;font-size:12px;line-height:18px;padding:3px 12px;color:#8a9699;flex-shrink:0;${style}`}
    >
      <a
        href={TERMS_PATH}
        data-terms-link
        style={`${item}text-decoration:underline;text-underline-offset:2px`}
      >
        {tFor(lang, "siteFooter.terms")}
      </a>
      <a
        href={SUPPORT_PHONE_HREF}
        data-site-phone
        style={`${item}text-decoration:none;font-weight:700;white-space:nowrap`}
      >
        {SUPPORT_PHONE_DISPLAY}
      </a>
      <span data-site-address style={item}>{BUSINESS_ADDRESS}</span>
    </footer>
  );
}
