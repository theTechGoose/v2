/**
 * REQ-782 (demo-loop dv1, issue d10) — Raphael: "Card payments should be a link to a separate
 * portal." The pure rules in `shared/payments/pay-links.ts` (the business's card pay link: https
 * only, projected on the card row; which portal "Pay by card" opens) and the wiring of the
 * invoice page, the portal page, the claim island and the settings card.
 */
import * as fs from "fs";
import * as path from "path";
import {
  cardPayWay,
  checkCardPayUrl,
  hasCardPayLink,
  payWayNames,
  projectPayMethods,
} from "../../shared/payments/pay-links.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const LINK = "https://buy.stripe.com/test_acme";

describe("REQ-782 the business's card pay link", () => {
  test("checkCardPayUrl: empty clears; https is kept; http, javascript:, host-less are refused", () => {
    expect(checkCardPayUrl(undefined)).toEqual({ ok: true, url: undefined });
    expect(checkCardPayUrl("  ")).toEqual({ ok: true, url: undefined });
    expect(checkCardPayUrl(` ${LINK} `)).toEqual({ ok: true, url: LINK });
    expect(checkCardPayUrl("http://buy.stripe.com/x")).toEqual({
      ok: false,
      reason: "url_not_https",
    });
    expect(checkCardPayUrl("javascript:alert(1)")).toEqual({
      ok: false,
      reason: "url_invalid",
    });
    expect(checkCardPayUrl("buy.stripe.com/x")).toEqual({
      ok: false,
      reason: "url_invalid",
    });
    expect(checkCardPayUrl(42)).toEqual({ ok: false, reason: "url_invalid" });
  });

  test("the projection carries the card's link on the card row (instructions unchanged); an unsafe link is dropped", () => {
    expect(
      projectPayMethods({
        card: { enabled: true, instructions: "Tap Pay by card", url: LINK },
      }),
    ).toEqual([{ method: "card", handle: "Tap Pay by card", url: LINK }]);
    expect(
      projectPayMethods({
        card: { enabled: true, url: "http://buy.stripe.com/x" },
      }),
    ).toEqual([{ method: "card", handle: undefined }]);
    // an owner who pasted the link where the placeholder said ("Payment link, or …")
    expect(
      projectPayMethods({ card: { enabled: true, instructions: LINK } }),
    ).toEqual([{ method: "card", handle: LINK, url: LINK }]);
    // off is off
    expect(projectPayMethods({ card: { enabled: false, url: LINK } })).toEqual(
      [],
    );
  });

  test("hasCardPayLink", () => {
    expect(hasCardPayLink([{ method: "card", url: LINK }])).toBe(true);
    expect(hasCardPayLink([{ method: "card", handle: "call me" }])).toBe(
      false,
    );
    expect(hasCardPayLink([])).toBe(false);
  });

  test("cardPayWay: the business's own Stripe → our card portal page; else the card pay link → that portal; else none", () => {
    const methods = [{ method: "card", url: LINK }];
    expect(cardPayWay({ invoiceId: "inv 1", stripe: true, methods })).toEqual({
      kind: "portal",
      href: "/i/inv%201/pay",
    });
    expect(
      cardPayWay({ invoiceId: "inv1", stripe: true, methods: [], lang: "es" }),
    ).toEqual({ kind: "portal", href: "/i/inv1/pay?lang=es" });
    expect(cardPayWay({ invoiceId: "inv1", stripe: false, methods })).toEqual({
      kind: "link",
      href: LINK,
      host: "buy.stripe.com",
    });
    expect(
      cardPayWay({
        invoiceId: "inv1",
        stripe: false,
        methods: [{ method: "card", handle: "Call me with your card" }],
      }),
    ).toBeNull();
    expect(cardPayWay({ invoiceId: "inv1", stripe: false, methods: [] }))
      .toBeNull();
  });

  test("the invoice text/email name card when the business has a card pay link", () => {
    expect(
      payWayNames([{ method: "card", url: LINK }], { card: false }),
    ).toEqual(["card"]);
    expect(payWayNames([{ method: "card", handle: "x" }], { card: false }))
      .toEqual([]);
  });
});

describe("REQ-782 the wiring", () => {
  const route = read("front-end/routes/i/[id].tsx");
  test("/i/:id offers Pay by card as a link to a separate portal — not the inline card widget", () => {
    expect(route).toMatch(/<PayByCard/);
    expect(route).not.toMatch(/<PublicCardPay/);
    expect(route).toMatch(/cardPayWay\(/);
  });
  test("the Pay by card button: the solid primary, the amount, a new tab, never handing the page over", () => {
    const btn = read("front-end/components/PayByCard.tsx");
    expect(btn).toMatch(/data-cy="pay-by-card"/);
    expect(btn).toMatch(/target="_blank"/);
    expect(btn).toMatch(/rel="noopener noreferrer"/);
    expect(btn).toMatch(/payByCard\.button/);
    // the owner, without a card way, is told how to set it up
    expect(btn).toMatch(/data-cy="pay-by-card-setup"/);
    expect(btn).toMatch(/\/settings#/);
  });
  test("the portal page /i/:id/pay hosts the card widget on the business's Stripe", () => {
    expect(exists("front-end/routes/i/[id]/pay.tsx")).toBe(true);
    const pay = read("front-end/routes/i/[id]/pay.tsx");
    expect(pay).toMatch(/<PublicCardPay/);
    expect(pay).toMatch(
      /ssrBackendGet<CardConfig>\(`\/invoices\/\$\{[^}]+\}\/card`\)/,
    );
    expect(pay).toMatch(/paycard\.css/);
    expect(pay).toMatch(/data-status-pill/);
    expect(pay).toMatch(/data-cy="card-portal-back"/);
  });
  test("Settings → the card row takes the card pay link, https only, with how-to copy", () => {
    const settings = read("front-end/islands/SettingsPage.tsx");
    expect(settings).toMatch(/data-cy="pay-card-url"/);
    expect(settings).toMatch(/settings\.pay\.cardUrl/);
    expect(settings).toMatch(/checkCardPayUrl\(/);
  });
  test("the backend refuses a non-https card link on save", () => {
    const ctrl = read(
      "backend/src/users/entrypoints/business-identity-controller/mod.ts",
    );
    expect(ctrl).toMatch(/checkCardPayUrl\(/);
    expect(ctrl).toMatch(/card_\$\{/);
    const dto = read("backend/src/users/dto/business-identity.ts");
    expect(dto).toMatch(/class CardMethod[\s\S]*?url\?: string/);
  });
  test("every new word exists in both languages", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const k of [
        "payByCard.button",
        "payByCard.buttonNoAmount",
        "payByCard.note",
        "payByCard.setup",
        "payByCard.setupLink",
        "payByCard.portal.heading",
        "payByCard.portal.back",
        "settings.pay.cardUrl",
        "settings.pay.cardUrlPh",
        "settings.pay.cardUrlHint",
        "settings.pay.cardUrlErr",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toBe("");
      expect(es[k]).not.toBe("");
    }
  });
});
