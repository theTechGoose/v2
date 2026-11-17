/**
 * REQ-513 (demo cycle 3, p8-pair1-b) — the dashboard setup checklist's deep links into Settings.
 *
 * Each checklist item opens `/settings#<anchor>`; SettingsPage stamps the same anchor as the id of
 * the field or card that answers it and, once the profile has loaded, scrolls that section into
 * view and focuses it. The browser's own hash jump cannot do it: it fires before the island has
 * drawn anything (Settings shows a skeleton until GET /profile returns).
 */

/** checklist item key → the id of the Settings section that answers it */
export const SETTINGS_ANCHORS = {
  name: "name",
  biz: "business",
  email: "email",
  logo: "logo",
  address: "address",
  payment: "payments",
  insurance: "insurance",
} as const;

export type SetupItemKey = keyof typeof SETTINGS_ANCHORS;

/** REQ-808 — the card payments section and its three tabs (`/settings#card-stripe` opens Stripe) */
export const CARD_ANCHORS = [
  "card-payments",
  "card-square",
  "card-stripe",
  "card-link",
] as const;

export type SettingsAnchor =
  | (typeof SETTINGS_ANCHORS)[SetupItemKey]
  | (typeof CARD_ANCHORS)[number];

const KNOWN = new Set<string>([
  ...Object.values(SETTINGS_ANCHORS),
  ...CARD_ANCHORS,
]);

/** the link a checklist item opens */
export function setupItemHref(key: SetupItemKey): string {
  return `/settings#${SETTINGS_ANCHORS[key]}`;
}

/** the known Settings section a location hash names, or null */
export function settingsAnchorOf(hash: string): SettingsAnchor | null {
  const id = decodeURIComponent(hash.replace(/^#/, "")).trim();
  return KNOWN.has(id) ? id as SettingsAnchor : null;
}

const FOCUSABLE =
  "input:not([type=hidden]):not([type=file]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])";

/**
 * Scroll the section the hash names into view and focus it (the element itself when it can take
 * focus, else its first control). Returns whether a section was found.
 */
export function revealSettingsAnchor(
  hash: string,
  doc: Document = document,
): boolean {
  const anchor = settingsAnchorOf(hash);
  if (!anchor) return false;
  const el = doc.getElementById(anchor);
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  const target = el.matches(FOCUSABLE)
    ? el
    : el.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus({ preventScroll: true });
  return true;
}
