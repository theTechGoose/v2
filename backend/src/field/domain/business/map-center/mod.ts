/**
 * REQ-288 — where the assignments map starts when it has no subscriptions to fit:
 * the business's own address (Settings → profile address), geocoded once; with no
 * address, the whole continental US. Never the dev seed's town.
 */
import type { BusinessAddress } from "@profile/dto/business-address.ts";

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

/** the continental US, zoomed out to show all of it */
export const US_VIEW: MapView = { lat: 39.5, lng: -98.35, zoom: 4 };

/** a town's worth of map around the business */
export const BUSINESS_ZOOM = 11;

const said = (s: string | undefined) => (s ?? "").trim();

/** "1600 Congress Ave, Austin, TX 78701" — or null when nothing names a place (a street alone does not) */
export function businessAddressLine(
  a: Partial<BusinessAddress> | null | undefined,
): string | null {
  if (!a) return null;
  const street = said(a.street), city = said(a.city);
  const state = said(a.state).toUpperCase(), postal = said(a.postal);
  if (!city && !state && !postal) return null;
  const tail = [state, postal].filter(Boolean).join(" ");
  return [street, city, tail].filter(Boolean).join(", ");
}
