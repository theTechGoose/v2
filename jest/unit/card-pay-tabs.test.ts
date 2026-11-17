/**
 * REQ-808 — Raphael, 2026-11-13: "make 3 tabs, one for square, one for stripe and one for custom
 * button. ship this as a hotfix." Settings' card-payment setup is ONE section with three real
 * tabs — Square | Stripe | Custom button — each holding that provider's existing setup. The pure
 * rules in `front-end/lib/card-pay-tabs.ts` (which tab opens, the keyboard, the deep links, when
 * the custom button is what the customer sees — the same rule as `cardPayWay`), and the wiring.
 */
import * as fs from "fs";
import * as path from "path";
import {
  CARD_SECTION_ANCHOR,
  CARD_TAB_ANCHOR,
  CARD_TABS,
  cardTabAfterKey,
  cardTabOfHash,
  customButtonNote,
  customButtonShown,
  openingCardTab,
} from "../../front-end/lib/card-pay-tabs";
import { settingsAnchorOf } from "../../front-end/lib/settings-anchors";
import { cardPayWay } from "../../shared/payments/pay-links";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const LINK = [{ method: "card", url: "https://buy.stripe.com/acme" }];

describe("REQ-808 card payment tabs — the pure rules", () => {
  test("three tabs, in this order: Square | Stripe | Custom button", () => {
    expect([...CARD_TABS]).toEqual(["square", "stripe", "link"]);
    expect(CARD_TAB_ANCHOR).toEqual({
      square: "card-square",
      stripe: "card-stripe",
      link: "card-link",
    });
    expect(CARD_SECTION_ANCHOR).toBe("card-payments");
  });

  test("the tab that opens is the active one — the one the customer pays through; none set → Square", () => {
    const none = { square: false, stripe: false, link: false };
    expect(openingCardTab(none)).toBe("square");
    expect(openingCardTab({ ...none, square: true })).toBe("square");
    expect(openingCardTab({ ...none, stripe: true })).toBe("stripe");
    expect(openingCardTab({ ...none, link: true })).toBe("link");
    // a gateway is what the customer sees over the custom button (cardPayWay)
    expect(openingCardTab({ ...none, square: true, link: true })).toBe(
      "square",
    );
    expect(openingCardTab({ ...none, stripe: true, link: true })).toBe(
      "stripe",
    );
    // both gateways (never, by REQ-803's rule): Stripe, as the customer sees it
    expect(openingCardTab({ square: true, stripe: true, link: true })).toBe(
      "stripe",
    );
  });

  test("a deep link to a tab opens that tab, whatever is active; the section's own anchor opens the active one", () => {
    const st = { square: true, stripe: false, link: false };
    expect(openingCardTab({ ...st, hash: "#card-stripe" })).toBe("stripe");
    expect(openingCardTab({ ...st, hash: "#card-link" })).toBe("link");
    expect(openingCardTab({ ...st, hash: "#card-payments" })).toBe("square");
    expect(openingCardTab({ ...st, hash: "#logo" })).toBe("square");
    expect(cardTabOfHash("#card-square")).toBe("square");
    expect(cardTabOfHash("card-link")).toBe("link");
    expect(cardTabOfHash("#card-payments")).toBeNull();
    expect(cardTabOfHash("")).toBeNull();
  });

  test("the keyboard: arrows move (and wrap), Home / End jump; anything else is not a tab key", () => {
    expect(cardTabAfterKey("square", "ArrowRight")).toBe("stripe");
    expect(cardTabAfterKey("stripe", "ArrowRight")).toBe("link");
    expect(cardTabAfterKey("link", "ArrowRight")).toBe("square");
    expect(cardTabAfterKey("square", "ArrowLeft")).toBe("link");
    expect(cardTabAfterKey("link", "ArrowLeft")).toBe("stripe");
    expect(cardTabAfterKey("link", "Home")).toBe("square");
    expect(cardTabAfterKey("square", "End")).toBe("link");
    expect(cardTabAfterKey("square", "Enter")).toBeNull();
    expect(cardTabAfterKey("square", "a")).toBeNull();
  });

  test("the custom button is what the customer sees only when no gateway is connected — the same rule as cardPayWay", () => {
    for (const square of [false, true]) {
      for (const stripe of [false, true]) {
        for (const link of [false, true]) {
          const way = cardPayWay({
            invoiceId: "i",
            stripe,
            square,
            methods: link ? LINK : [],
          });
          expect([
            square,
            stripe,
            link,
            customButtonShown({ square, stripe, link }),
          ])
            .toEqual([square, stripe, link, way?.kind === "link"]);
        }
      }
    }
    expect(customButtonNote({ square: true, stripe: false })).toBe(
      "behindSquare",
    );
    expect(customButtonNote({ square: false, stripe: true })).toBe(
      "behindStripe",
    );
    expect(customButtonNote({ square: true, stripe: true })).toBe(
      "behindStripe",
    );
    expect(customButtonNote({ square: false, stripe: false })).toBeNull();
  });

  test("Settings' deep-link reader knows the card section and its tabs", () => {
    expect(settingsAnchorOf("#card-payments")).toBe("card-payments");
    expect(settingsAnchorOf("#card-square")).toBe("card-square");
    expect(settingsAnchorOf("#card-stripe")).toBe("card-stripe");
    expect(settingsAnchorOf("#card-link")).toBe("card-link");
    expect(settingsAnchorOf("#payments")).toBe("payments");
  });
});

describe("REQ-808 the wiring", () => {
  const s = read("front-end/islands/SettingsPage.tsx");

  test("one section, real tabs: tablist / tab / tabpanel, aria-selected, aria-controls, roving tabindex, the keyboard", () => {
    expect(s).toMatch(/function CardPaymentsTabs\(/);
    expect(s).toMatch(/<CardPaymentsTabs /);
    expect(s).toMatch(/role="tablist"/);
    expect(s).toMatch(/role="tab"/);
    expect(s).toMatch(/role="tabpanel"/);
    expect(s).toMatch(/aria-selected=\{/);
    expect(s).toMatch(/aria-controls=\{/);
    expect(s).toMatch(/aria-labelledby=\{/);
    expect(s).toMatch(/tabIndex=\{/);
    expect(s).toMatch(/cardTabAfterKey\(/);
    expect(s).toMatch(/openingCardTab\(/);
    expect(s).toMatch(/id=\{CARD_SECTION_ANCHOR\}/);
    expect(s).toMatch(/data-cy=\{`card-tab-\$\{/);
  });

  test("each tab holds that provider's existing setup — moved, not rebuilt — and the old standalone cards are gone", () => {
    expect(s).toMatch(/<SquarePaymentsCard[^>]*embedded/);
    expect(s).toMatch(/<CardPaymentsCard[^>]*embedded/);
    expect(s).toMatch(/<CardLinkPanel\b/);
    // the "Other payment links" card (REQ-630) is the rest of the Custom button tab
    expect(s).toMatch(
      /<PayLinksCard\s+snapshot=\{snapshot\}\s+onSaved=\{onSaved\}\s+embedded/,
    );
    expect(s).not.toMatch(
      /<PayLinksCard snapshot=\{p\} onSaved=\{onSaved\} \/>/,
    );
    // not mounted on their own any more
    expect(s).not.toMatch(/<CardPaymentsCard snapshot=\{p\} \/>/);
    expect(s).not.toMatch(/<SquarePaymentsCard snapshot=\{p\} \/>/);
    // the custom button panel keeps the card link field and its rule
    expect(s).toMatch(/data-cy="pay-card-url"/);
    expect(s).toMatch(/data-cy="pay-card-url-save"/);
    expect(s).toMatch(/checkCardPayUrl\(/);
    // the Payments card points at the tab instead of holding the field
    expect(s).toMatch(/data-cy="pay-card-url-moved"/);
    expect(s).toMatch(/href=\{`#\$\{CARD_TAB_ANCHOR\.link\}`\}/);
  });

  test("one provider at a time, said inside the tabs; the custom tab says when its button shows", () => {
    expect(s).toMatch(/data-cy="stripe-square-on"/);
    expect(s).toMatch(/settings\.stripe\.squareOn/);
    expect(s).toMatch(/data-cy="square-stripe-on"/);
    expect(s).toMatch(/customButtonNote\(/);
    expect(s).toMatch(/settings\.cardTabs\.linkBehind/);
  });

  test("the owner's 'set up card payments' hint on /i lands on the card section", () => {
    const btn = read("front-end/components/PayByCard.tsx");
    expect(btn).toMatch(/href="\/settings#card-payments"/);
  });

  test("every new word exists in both languages", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const k of [
        "settings.cardTabs.title",
        "settings.cardTabs.intro",
        "settings.cardTabs.square",
        "settings.cardTabs.stripe",
        "settings.cardTabs.link",
        "settings.cardTabs.connected",
        "settings.cardTabs.on",
        "settings.cardTabs.linkIntro",
        "settings.cardTabs.linkBehindSquare",
        "settings.cardTabs.linkBehindStripe",
        "settings.cardTabs.linkSave",
        "settings.cardTabs.linkRemove",
        "settings.cardTabs.linkMoved",
        "settings.cardTabs.linkMovedCta",
        "settings.stripe.squareOn",
      ]
    ) {
      expect([k, typeof en[k], typeof es[k]]).toEqual([k, "string", "string"]);
      expect(en[k]).not.toBe("");
      expect(es[k]).not.toBe("");
    }
    expect(en["settings.cardTabs.link"]).toBe("Custom button");
    // Square is a real connection now, not "a link" in the payment-links copy
    expect(en["settings.payLinks.intro"]).not.toMatch(/— Square,/);
    expect(es["settings.payLinks.intro"]).not.toMatch(/— Square,/);
  });
});
