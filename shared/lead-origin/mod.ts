/**
 * REQ-211 — Raphael, 2026-11-06: "There is something that says what landing page it is coming
 * from?" — "can you make it so the answer is yes?". The lead origin: the page a landing form was
 * on and the ad that brought the person (`?ad=`, REQ-147). The browser attaches it to every
 * landing post (leadOriginHere); the server reads it leniently (leadOriginOf) — a path of safe
 * characters, a short ad id — and DROPS what it cannot read: the form's job is the lead, the
 * tracking rides along or not. Shared: the front-end's clients and the backend's parsers both
 * read this one file.
 */
export interface LeadOrigin {
  /** the page's pathname: "/", "/landing5" … */
  page: string;
  /** the ad id on the page's URL (`?ad=`), lowercased, when there was one */
  ad?: string;
}

export const PAGE_MAX = 80;
export const AD_MAX = 40;
const PAGE_RE = /^\/[A-Za-z0-9\-_./]*$/;
const AD_RE = /^[a-z0-9\-_]+$/;

/** the origin in a form's post — `page` and `ad` fields — or nothing when the page cannot be read */
export function leadOriginOf(input: unknown): LeadOrigin | undefined {
  if (!input || typeof input !== "object") return undefined;
  const b = input as Record<string, unknown>;
  if (typeof b.page !== "string") return undefined;
  const page = b.page.trim().split(/[?#]/)[0];
  if (!page || page.length > PAGE_MAX || !PAGE_RE.test(page)) return undefined;
  const ad = typeof b.ad === "string" ? b.ad.trim().toLowerCase() : "";
  return ad && ad.length <= AD_MAX && AD_RE.test(ad) ? { page, ad } : { page };
}

/** "/landing5?ad=cumple", "/landing2", or "" for none */
export function leadOriginLabel(origin: LeadOrigin | undefined): string {
  if (!origin) return "";
  return origin.ad ? `${origin.page}?ad=${origin.ad}` : origin.page;
}

/** the CRM's lead source: the base ("paperworkmonster.com") and, when known, the page and the ad after a
 *  separator — "paperworkmonster.com · /landing5?ad=cumple" — never the base as a URL (REQ-086) */
export function leadSourceFor(
  base: string,
  origin: LeadOrigin | undefined,
): string {
  const label = leadOriginLabel(origin);
  return label ? `${base} · ${label}` : base;
}

/** the browser's side: the fields to post from where the page is; nothing on the server */
export function leadOriginHere(
  location: { pathname: string; search: string } | undefined =
    typeof globalThis.location === "object" && globalThis.location
      ? globalThis.location
      : undefined,
): { page: string; ad?: string } | Record<never, never> {
  if (!location || typeof location.pathname !== "string") return {};
  const ad = new URLSearchParams(location.search ?? "").get("ad")?.trim()
    .toLowerCase() ?? "";
  return ad ? { page: location.pathname, ad } : { page: location.pathname };
}
