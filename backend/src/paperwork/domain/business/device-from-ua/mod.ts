export type Device = "desktop" | "mobile" | "tablet" | "unknown";

/**
 * Coarse device classification from a UA string. Pure function — no UA
 * parsing library; just the four buckets the engagement timeline shows.
 *
 *   - tablet:  "ipad", "tablet", "android" + "mobile" absent
 *   - mobile:  "iphone", "ipod", "android" + "mobile", "mobile"
 *   - desktop: "windows", "macintosh", "x11", "linux"
 *   - unknown: anything else (or empty)
 */
export function deviceFromUa(ua: string): Device {
  if (!ua) return "unknown";
  const s = ua.toLowerCase();
  if (s.includes("ipad") || s.includes("tablet")) return "tablet";
  if (s.includes("android") && !s.includes("mobile")) return "tablet";
  if (s.includes("iphone") || s.includes("ipod") || s.includes("mobile") || s.includes("android")) return "mobile";
  if (s.includes("windows") || s.includes("macintosh") || s.includes("x11") || s.includes("linux")) return "desktop";
  return "unknown";
}
