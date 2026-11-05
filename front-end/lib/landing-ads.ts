/**
 * REQ-147 — the ad the person tapped. The Meta ads landings (/landing3, /landing4, /landing5)
 * open on the photo and the headline of the ad that brought the person: each ad's destination
 * URL carries `?ad=<id>`, the hero shows that ad, and on /landing3 and /landing4 the three
 * outcome cards show the OTHER three. Absent or unknown, the birthday ad (cumple) — the mock's
 * default. The headlines live in the dictionaries (`landing3.ad.<id>`, `landing3.adAlt.<id>`);
 * the photos are tracked files under front-end/static (REQ-075).
 */
export const AD_IDS = ["cumple", "domingo", "sabado", "graduacion"] as const;
export type AdId = typeof AD_IDS[number];
export const DEFAULT_AD: AdId = "cumple";

/** one of the four ids, cumple when absent, blank or unknown; case and spaces do not matter */
export function pickAd(param: string | null | undefined): AdId {
  const id = (param ?? "").trim().toLowerCase();
  return (AD_IDS as readonly string[]).includes(id) ? id as AdId : DEFAULT_AD;
}

/** the ad named by the page's URL (`?ad=`) */
export function adFromUrl(url: URL): AdId {
  return pickAd(url.searchParams.get("ad"));
}

/** the tracked photo of an ad: /ad-cumple.jpg … */
/** the four photos, tracked under static (REQ-075) */
const AD_PHOTO: Record<AdId, string> = {
  cumple: "/ad-cumple.jpg",
  domingo: "/ad-domingo.jpg",
  sabado: "/ad-sabado.jpg",
  graduacion: "/ad-graduacion.jpg",
};
export function adPhoto(id: AdId): string {
  return AD_PHOTO[id];
}

/** the other three ads, in the list's order — the outcome cards' photos */
export function otherAds(id: AdId): AdId[] {
  return AD_IDS.filter((a) => a !== id);
}
