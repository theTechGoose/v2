/**
 * REQ-044 — the business's public contact details, in ONE place.
 *
 * "change the number everywhere on the site to 855-362-8666. add the phone
 * number to the footer on every page as well as the address." Every page
 * that prints the support number or the mailing address (the site footer,
 * the two landings, /contact, the dashboard "Call support" CTA) reads these,
 * so the number is spelled out nowhere else in the site source (pinned by
 * jest/unit/support-contact.test.ts). Pure data, no imports.
 */

/** The toll-free support line, as dialled. */
export const SUPPORT_PHONE_E164 = "+18553628666";
/** The toll-free support line, as printed — the client's own format. */
export const SUPPORT_PHONE_DISPLAY = "855-362-8666";
/** The `href` of every "call us" link. */
export const SUPPORT_PHONE_HREF = `tel:${SUPPORT_PHONE_E164}`;

/** The business mailing address — the same one the legal documents carry
 *  (REQ-043 amendment). */
export const BUSINESS_ADDRESS = "4505 Socastee Blvd, Myrtle Beach, SC 29588";
