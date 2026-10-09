import { type Lang, tFor } from "../lib/i18n.ts";
import { LEGAL_LINKS } from "../../shared/legal/terms.ts";
import {
  BUSINESS_ADDRESS,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_HREF,
} from "../../shared/legal/contact.ts";

/**
 * REQ-043 — the site footer every page ends with. REQ-067 (Hans, 2026-10-05):
 * "Terms of Service | Refund & Cancellation Policy | Privacy Policy | SMS
 * Terms & Conditions" — the four policy links, in that order, from the one
 * list (shared/legal/terms.ts LEGAL_LINKS), each to its own page (REQ-066).
 * REQ-044 adds the support phone (a `tel:` link) and the business mailing
 * address. Styled inline so it drops into every shell (the landing footers,
 * the login/verify/contact card, the dashboard `.content` scroll, the public
 * documents, the assistant page, the error page, the legal pages) without
 * touching their stylesheets.
 *
 * Height: 30px lines (3px + a 24px tap box + 3px) with the items 12px apart
 * (the hit-target audit's 8px minimum between controls, with room to spare);
 * on narrow screens they wrap to more lines, so the assistant shell's `.asst`
 * sizes itself to the space left (flex), not to a fixed height
 * (assistant-page.css).
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
      style={`display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:0 12px;text-align:center;font-size:12px;line-height:18px;padding:3px 12px;color:#8a9699;flex-shrink:0;${style}`}
    >
      {LEGAL_LINKS.map((l) => (
        <a
          key={l.id}
          href={l.path}
          data-legal-link={l.id}
          data-terms-link={l.id === "terms" ? "" : undefined}
          style={`${item}text-decoration:underline;text-underline-offset:2px`}
        >
          {tFor(lang, l.labelKey)}
        </a>
      ))}
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
