/**
 * REQ-613 (demo-loop cycle 4, issue M31) — the URL a customer document (the public quote, the
 * public invoice, a paperwork email) draws the business logo from. It carries the logo's
 * version, so replacing the logo gives every document a new URL and no browser can keep
 * showing the old one from its cache. Pure; shared by the server (projection, route, emails)
 * and the pages.
 */

export type PublicLogoKind = "quote" | "invoice";

/** A short, stable tag for one logo file: FNV-1a over its id, base 36. A replaced logo is a
 *  new file and so a new tag; the file id itself never reaches the page. */
export function logoVersion(fileId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < fileId.length; i++) {
    h ^= fileId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** `/api/public-logo/<kind>/<id>?v=<version>`; no `?v=` when the version is unknown (the
 *  route then revalidates every load). `base` prefixes an absolute origin for emails. */
export function publicLogoUrl(
  kind: PublicLogoKind,
  id: string,
  version: string | undefined,
  base = "",
): string {
  const url = `${base}/api/public-logo/${kind}/${encodeURIComponent(id)}`;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}
