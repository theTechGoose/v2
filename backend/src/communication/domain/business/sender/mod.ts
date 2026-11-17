/**
 * REQ-123 — Raphael, 2026-10-27: "i do not want to SEND ANYTHING VIA monsterrg.com can we send
 * everything via documonster instead?"
 *
 * Where every email leaves from. One module, no env var: until now the From was whatever sender
 * variable the process carried — a monsterrg.com address in every box (the gate's runs and the
 * dev pins) and in main's env file, a quotejefe.com one on Deno Deploy — and the paperwork alias
 * domain was paperworkmonster.com in code. documonster.com is a verified Postmark domain (its
 * pm-bounces return-path is Postmark's; the 2026-10-22 probes from it were accepted).
 *
 * The house From carries the brand as its display name (REQ-071: the brand is DocuMonster) and
 * the inbox the site names everywhere (hello@documonster.com — the legal pages, /landing2, the
 * signup notices of REQ-103), so a reply to a login code lands with the team. A contractor's
 * paperwork keeps roadmap p.7's per-business alias, on this domain. Pure.
 */

/** the domain every email leaves from */
export const SEND_DOMAIN = "documonster.com";

/** the From of everything that is not a contractor's own paperwork: login codes, the team's
 *  contact/demo/call notices, the signup notices */
export const HOUSE_FROM = `"DocuMonster" <hello@${SEND_DOMAIN}>`;

const ALIAS = /^[a-z0-9-]+$/;

/** the From of a contractor's paperwork: their business alias at the domain (roadmap p.7 — the
 *  slug of the business name, BusinessIdentityStore makes it unique), noreply@ when none is on
 *  file or the alias is not a slug */
export function aliasFrom(alias: string | undefined | null): string {
  const slug = (alias ?? "").trim();
  return ALIAS.test(slug) ? `${slug}@${SEND_DOMAIN}` : `noreply@${SEND_DOMAIN}`;
}

/** REQ-628: the From of a contractor's paperwork to their customer — the business's name as the
 *  display name ("A2Z Landscape LLC" <a2z-landscape-llc@documonster.com>), so the customer's inbox
 *  names the business, never DocuMonster. No name → the bare alias. Quotes, angle brackets and
 *  line breaks are dropped from the name so it can never break the header. */
export function businessFrom(input: { alias?: string | null; name?: string | null }): string {
  const address = aliasFrom(input.alias);
  const name = (input.name ?? "").replace(/[\r\n"<>\\]/g, " ").replace(/\s+/g, " ").trim();
  return name ? `"${name}" <${address}>` : address;
}

/** the bare, lowercased address of a From line: `"Name" <addr>` or `addr` */
export function senderAddress(from: string): string {
  const inAngles = from.match(/<([^<>]*)>\s*$/);
  return (inAngles ? inAngles[1] : from).trim().toLowerCase();
}

/** the seam's rule (EmailService): a From is on SEND_DOMAIN or it does not leave */
export function fromDocumonster(from: string): boolean {
  const address = senderAddress(from);
  const at = address.lastIndexOf("@");
  return at > 0 && address.slice(at + 1) === SEND_DOMAIN;
}
