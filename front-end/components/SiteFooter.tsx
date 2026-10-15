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
 * business mailing address.
 *
 * Shape (REQ-078, Raphael, 2026-10-15, "can you make this better" — the
 * links had wrapped into the phone's row): the four links in a two-column
 * grid, two by two, the columns lined up, so a link never shares a row with
 * the phone; then the phone and the address, each on its own line beneath.
 * Every item is one line (24px tap boxes; 8px between the grid's rows and
 * between the blocks, the hit-target audit's minimum). The grid's tracks are
 * `minmax(0, max-content)`, so on a phone narrower than the two longest
 * labels a label wraps inside its cell instead of pushing the page sideways.
 *
 * Placement (REQ-079, Raphael, the same day, on that block inside the login
 * card: "just make this the actual footer"): this IS the page's footer. It
 * paints itself — the brand teal, square corners, the full width of whatever
 * ends with it — so it needs no stylesheet and no per-page dressing (no
 * `style` prop): the card pages (login, verify, contact, pay, plan) render it
 * after the card as the shell's last child, the dashboard's pane bleeds it to
 * its edges (dashboard.css `.content > .site-footer`), the assistant column,
 * the error page, the public documents, the welcome shell and the legal pages
 * end with it edge to edge. Before, verify.css's generic `footer` rule painted
 * it teal by accident inside the card, as a rounded strip; that rule is gone.
 */
export default function SiteFooter({ lang = "en" }: { lang?: Lang }) {
  const item =
    "display:inline-block;min-height:24px;padding:0 3px;line-height:24px;white-space:nowrap;color:inherit;";
  return (
    <footer
      class="site-footer"
      data-site-footer
      style="display:flex;flex-direction:column;align-items:center;gap:8px;box-sizing:border-box;padding:18px 16px calc(18px + env(safe-area-inset-bottom, 0px));background:var(--brand-teal,#1a535c);color:rgba(255,255,255,0.82);text-align:center;font-size:12px;line-height:24px;flex-shrink:0;"
    >
      <nav
        data-site-footer-links
        aria-label={tFor(lang, "siteFooter.policiesAria")}
        style="display:grid;grid-template-columns:repeat(2,minmax(0,max-content));justify-content:center;column-gap:18px;row-gap:8px;max-width:100%;"
      >
        {LEGAL_LINKS.map((l) => (
          <a
            key={l.id}
            href={l.path}
            data-legal-link={l.id}
            data-terms-link={l.id === "terms" ? "" : undefined}
            style={`${item}white-space:normal;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px`}
          >
            {tFor(lang, l.labelKey)}
          </a>
        ))}
      </nav>
      <div
        data-site-footer-contact
        style="display:flex;flex-direction:column;align-items:center;"
      >
        <a
          href={SUPPORT_PHONE_HREF}
          data-site-phone
          style={`${item}text-decoration:none;font-weight:700;color:#fff`}
        >
          {SUPPORT_PHONE_DISPLAY}
        </a>
        <span data-site-address style={item}>{BUSINESS_ADDRESS}</span>
      </div>
    </footer>
  );
}
