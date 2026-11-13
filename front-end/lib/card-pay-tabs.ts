/**
 * REQ-808 — Raphael, 2026-11-13: "make 3 tabs, one for square, one for stripe and one for custom
 * button." Settings' card-payment setup is one section with three tabs. The pure rules:
 *
 *   - the tabs, their order and their deep-link anchors (`/settings#card-square` …; the
 *     section itself is `#card-payments`);
 *   - which tab opens: the one the customer pays through — Stripe, else Square, else the custom
 *     button (the order of `cardPayWay`, shared/payments/pay-links.ts) — and Square when none is
 *     set; a deep link to a tab wins;
 *   - the keyboard (WAI-ARIA tabs: arrows wrap, Home / End);
 *   - when the custom button is what the customer sees: only while no gateway is connected
 *     (REQ-782's rule, unchanged), and which note its tab shows otherwise.
 */
export const CARD_TABS = ["square", "stripe", "link"] as const;
export type CardTab = (typeof CARD_TABS)[number];

export const CARD_TAB_ANCHOR: Record<CardTab, string> = {
  square: "card-square",
  stripe: "card-stripe",
  link: "card-link",
};
export const CARD_SECTION_ANCHOR = "card-payments";

export interface CardSetup {
  square: boolean;
  stripe: boolean;
  /** the custom button: Credit card on with an https card payment link */
  link: boolean;
}

/** the tab a location hash names, or null */
export function cardTabOfHash(hash: string | undefined | null): CardTab | null {
  const id = decodeURIComponent((hash ?? "").replace(/^#/, "")).trim();
  return CARD_TABS.find((t) => CARD_TAB_ANCHOR[t] === id) ?? null;
}

export function openingCardTab(
  setup: CardSetup & { hash?: string | null },
): CardTab {
  const asked = cardTabOfHash(setup.hash);
  if (asked) return asked;
  if (setup.stripe) return "stripe";
  if (setup.square) return "square";
  if (setup.link) return "link";
  return "square";
}

export function cardTabAfterKey(current: CardTab, key: string): CardTab | null {
  const i = CARD_TABS.indexOf(current);
  const n = CARD_TABS.length;
  switch (key) {
    case "ArrowRight":
      return CARD_TABS[(i + 1) % n];
    case "ArrowLeft":
      return CARD_TABS[(i - 1 + n) % n];
    case "Home":
      return CARD_TABS[0];
    case "End":
      return CARD_TABS[n - 1];
    default:
      return null;
  }
}

/** The customer's /i shows the custom button only while no gateway is connected. */
export function customButtonShown(setup: CardSetup): boolean {
  return setup.link && !setup.square && !setup.stripe;
}

/** What the custom tab says while a gateway takes the card instead (Stripe first, as cardPayWay). */
export function customButtonNote(
  setup: { square: boolean; stripe: boolean },
): "behindSquare" | "behindStripe" | null {
  if (setup.stripe) return "behindStripe";
  if (setup.square) return "behindSquare";
  return null;
}
