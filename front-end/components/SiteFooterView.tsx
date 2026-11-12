import type { LegalDocId } from "../../shared/legal/terms.ts";
import {
  BUSINESS_ADDRESS,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_HREF,
} from "../../shared/legal/contact.ts";

/**
 * REQ-367 — the footer's words in one language: the policies grid's label and
 * the four policy links (REQ-067/076: from the one list, LEGAL_LINKS, in its
 * order). Built on the server by `siteFooterCopy` (components/SiteFooter.tsx)
 * and handed to the live island for both languages, so the browser needs no
 * dictionary to switch them.
 */
export interface SiteFooterCopy {
  policiesAria: string;
  /** REQ-509: "Powered by DocuMonster", the document footer's credit */
  poweredBy: string;
  links: { id: LegalDocId; path: string; label: string }[];
}

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
 *
 * REQ-367: this is the markup only. Pages render `SiteFooter`
 * (components/SiteFooter.tsx), which mounts it in the SiteFooterLive island so
 * it follows the EN/ES switch; the island is the only thing that renders it.
 */
export default function SiteFooterView(
  { copy, compact = false, document: forDocument = false }: {
    copy: SiteFooterCopy;
    compact?: boolean;
    /** REQ-509: the contractor's customer documents (/q, /i, /co) */
    document?: boolean;
  },
) {
  const item =
    "display:inline-block;min-height:24px;padding:0 3px;line-height:24px;white-space:nowrap;color:inherit;";
  if (forDocument) return <DocumentFooter copy={copy} item={item} />;
  if (compact) return <CompactFooter copy={copy} item={item} />;
  return (
    <footer
      class="site-footer"
      data-site-footer
      style="display:flex;flex-direction:column;align-items:center;gap:8px;box-sizing:border-box;padding:18px 16px calc(18px + env(safe-area-inset-bottom, 0px));background:var(--brand-teal,#1a535c);color:rgba(255,255,255,0.82);text-align:center;font-size:12px;line-height:24px;flex-shrink:0;"
    >
      <nav
        data-site-footer-links
        aria-label={copy.policiesAria}
        style="display:grid;grid-template-columns:repeat(2,minmax(0,max-content));justify-content:center;column-gap:18px;row-gap:8px;max-width:100%;"
      >
        {copy.links.map((l) => (
          <a
            key={l.id}
            href={l.path}
            data-legal-link={l.id}
            data-terms-link={l.id === "terms" ? "" : undefined}
            style={`${item}white-space:normal;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px`}
          >
            {l.label}
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

/**
 * REQ-425 (demo-loop cycle 2, p6) — the footer of the signed-in app routes.
 * The full block above (a two-by-two grid, then the phone, then the address:
 * 120-150 px) took that height from the assistant's chat and its in-chat
 * calendar, and from every pane. Here the same four policy links and
 * REQ-044's phone and address sit on ONE line (11px type, 24px tap boxes,
 * 4px of padding: a 32px strip). The Spanish line is the long one: it fits
 * the app's pane at 1280px with these gaps, which is why there is no © on it
 * (with one it wrapped to two rows). Narrower than the line it wraps instead
 * of scrolling sideways. Same teal, same full width, same data hooks.
 *
 * REQ-509 (demo-loop cycle 3, m24): on a phone (≤640px) the line still wrapped
 * to three or four rows under the chat box, so there the phone and the address
 * are hidden and the footer is the four links alone. The rule rides inside the
 * footer as a <style> element — the footer is inline-styled and needs no page
 * stylesheet, and a body <style> rendered by the island is in its own markup
 * on both sides of hydration (unlike a Head <style>).
 */
const COMPACT_PHONE_CSS =
  "@media (max-width: 640px) { .site-footer--compact [data-site-phone], .site-footer--compact [data-site-address] { display: none !important; } }";

function CompactFooter(
  { copy, item }: { copy: SiteFooterCopy; item: string },
) {
  return (
    <footer
      class="site-footer site-footer--compact"
      data-site-footer
      data-site-footer-compact
      style="display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:center;column-gap:12px;row-gap:0;box-sizing:border-box;padding:4px 12px calc(4px + env(safe-area-inset-bottom, 0px));background:var(--brand-teal,#1a535c);color:rgba(255,255,255,0.82);text-align:center;font-size:11px;line-height:24px;flex-shrink:0;"
    >
      <nav
        data-site-footer-links
        aria-label={copy.policiesAria}
        style="display:flex;flex-wrap:wrap;justify-content:center;column-gap:8px;"
      >
        {copy.links.map((l) => (
          <a
            key={l.id}
            href={l.path}
            data-legal-link={l.id}
            data-terms-link={l.id === "terms" ? "" : undefined}
            style={`${item}text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px`}
          >
            {l.label}
          </a>
        ))}
      </nav>
      <a
        href={SUPPORT_PHONE_HREF}
        data-site-phone
        style={`${item}text-decoration:none;font-weight:700;color:#fff`}
      >
        {SUPPORT_PHONE_DISPLAY}
      </a>
      <span data-site-address style={item}>{BUSINESS_ADDRESS}</span>
      <style>{COMPACT_PHONE_CSS}</style>
    </footer>
  );
}

/**
 * REQ-509 (demo-loop cycle 3, m24) — the footer of the contractor's public
 * customer documents: the quote /q, the invoice /i, the change order /co. The
 * full block printed DocuMonster's support phone and Myrtle Beach address
 * right under the contractor's own contact block, so a customer read them as
 * the contractor's. Here: the four policy links (they stay — REQ-067/076, the
 * SMS terms and privacy policy every page links for A2P) and "Powered by
 * DocuMonster", one wrapping line in the compact footer's measures. No
 * DocuMonster phone, no address; the document's own header names the
 * contractor and how to reach them.
 */
function DocumentFooter(
  { copy, item }: { copy: SiteFooterCopy; item: string },
) {
  return (
    <footer
      class="site-footer site-footer--document"
      data-site-footer
      data-site-footer-document
      style="display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:center;column-gap:12px;row-gap:0;box-sizing:border-box;padding:6px 12px calc(6px + env(safe-area-inset-bottom, 0px));background:var(--brand-teal,#1a535c);color:rgba(255,255,255,0.82);text-align:center;font-size:11px;line-height:24px;flex-shrink:0;"
    >
      <nav
        data-site-footer-links
        aria-label={copy.policiesAria}
        style="display:flex;flex-wrap:wrap;justify-content:center;column-gap:8px;"
      >
        {copy.links.map((l) => (
          <a
            key={l.id}
            href={l.path}
            data-legal-link={l.id}
            data-terms-link={l.id === "terms" ? "" : undefined}
            style={`${item}text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px`}
          >
            {l.label}
          </a>
        ))}
      </nav>
      <span
        data-site-powered-by
        style={`${item}font-weight:700;color:#fff`}
      >
        {copy.poweredBy}
      </span>
    </footer>
  );
}
