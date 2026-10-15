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
 * list (shared/legal/terms.ts LEGAL_LINKS), each straight to its own page
 * (REQ-066; REQ-076 brought them back, broken out, never one link to a
 * tabbed page). REQ-044 adds the support phone (a `tel:` link) and the
 * business mailing address. Styled inline so it drops into every shell (the
 * landing footers, the login/verify/contact card, the dashboard `.content`
 * scroll, the public documents, the assistant page, the error page, the
 * legal pages) without touching their stylesheets.
 *
 * Shape (REQ-078, Raphael, 2026-10-15, on the login card's strip: "can you
 * make this better" — the links had wrapped into the phone's row): TWO
 * blocks. The four links sit in a two-column grid, two by two, so a link
 * never shares a row with the phone and the columns line up; then the phone
 * and the address, on their own line beneath (they share that line where it
 * is wide enough, and the address wraps under the phone on a phone). The
 * footer itself still wraps, so a wide shell gets the grid and the contact
 * line side by side.
 *
 * Height: 24px one-line items (each a 24px tap box, no vertical padding;
 * the hit-target audit's 8px between controls — 8px between grid rows, 8px
 * between the blocks). The 480px card: five rows — the links two by two, the
 * phone, the address — 124px, desktop or phone ("the blue part … its
 * supposed to be a small thing"; it was 3–5 ragged rows before). Rounded with
 * the app's --radius-lg (16px) so the teal strip the card paints speaks the
 * design language. The assistant shell's `.asst` sizes itself to the space
 * left (flex), not to a fixed height (assistant-page.css).
 */
export default function SiteFooter(
  { lang = "en", style = "" }: { lang?: Lang; style?: string },
) {
  const item =
    "display:inline-block;min-height:24px;padding:0 3px;line-height:24px;white-space:nowrap;color:inherit;";
  return (
    <footer
      class="site-footer"
      data-site-footer
      style={`display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px 20px;text-align:center;font-size:12px;line-height:24px;padding:6px 12px;border-radius:var(--radius-lg,16px);color:#8a9699;flex-shrink:0;${style}`}
    >
      <nav
        data-site-footer-links
        aria-label={tFor(lang, "siteFooter.policiesAria")}
        style="display:grid;grid-template-columns:repeat(2,max-content);justify-content:center;column-gap:18px;row-gap:8px;"
      >
        {LEGAL_LINKS.map((l) => (
          <a
            key={l.id}
            href={l.path}
            data-legal-link={l.id}
            data-terms-link={l.id === "terms" ? "" : undefined}
            style={`${item}text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px`}
          >
            {tFor(lang, l.labelKey)}
          </a>
        ))}
      </nav>
      <div
        data-site-footer-contact
        style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:0 10px;"
      >
        <a
          href={SUPPORT_PHONE_HREF}
          data-site-phone
          style={`${item}text-decoration:none;font-weight:700`}
        >
          {SUPPORT_PHONE_DISPLAY}
        </a>
        <span data-site-address style={item}>{BUSINESS_ADDRESS}</span>
      </div>
    </footer>
  );
}
