/**
 * REQ-213 — the public invoice's card pay: the island, the route and the backend are wired.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

describe("REQ-213 the island", () => {
  const island = read("front-end/islands/PublicCardPay.tsx");
  test("the flip card widget: number, holder, expiry, CVC; the back shows while the CVC has focus", () => {
    expect(island).toMatch(
      /class=\{`pc-card\$\{flipped \? " pc-card--active" : ""\}`\}/,
    );
    expect(island).toMatch(/data-cy="card-number"/);
    expect(island).toMatch(/data-cy="card-holder"/);
    expect(island).toMatch(/data-cy="card-expiry"/);
    expect(island).toMatch(/data-cy="card-cvc"/);
    expect(island).toMatch(/const flipped = focused === "cvc"/); // REQ-216: one focus state drives the flip, the ring and the mask
    expect(island).toMatch(/onFocus: \(\) => setFocused\(f\)/);
    expect(island).toMatch(/brandOf\(/);
    expect(island).toMatch(/formatCardNumber\(/);
    expect(island).toMatch(/formatExpiry\(/);
  });
  test("the merchant header carries the business's logo and name; the button names the amount", () => {
    expect(island).toMatch(/data-cy="card-merchant"/);
    expect(island).toMatch(/data-cy="card-merchant-logo"/);
    expect(island).toMatch(/data-cy="card-pay-submit"/);
    expect(island).toMatch(/publicCardPay\.pay/);
  });
  test("the card goes to Stripe with the publishable key, never to this app; then the server charges", () => {
    expect(island).toMatch(/`\$\{apiBase\}\/v1\/payment_methods`/);
    expect(island).toMatch(/authorization: `Bearer \$\{cfg\.publishableKey/);
    expect(island).toMatch(/paymentMethodForm\(/);
    expect(island).toMatch(/`\/api\/invoices\/\$\{invoiceId\}\/card`/);
    expect(island).toMatch(
      /`\/api\/invoices\/\$\{invoiceId\}\/card\/complete`/,
    );
    expect(island).toMatch(/cardPayDecision\(/);
    expect(island).toMatch(/handleNextAction\(/);
    expect(island).toMatch(/js\.stripe\.com\/v3/);
  });
  test("paid, declined and stale are told apart on the page; the SSR pill flips to paid", () => {
    expect(island).toMatch(/data-cy="card-paid"/);
    expect(island).toMatch(/data-cy="card-error"/);
    expect(island).toMatch(/\[data-status-pill\]/);
    expect(island).toMatch(/\[data-claim-wrap\]/);
  });
});

describe("REQ-213 the route", () => {
  const route = read("front-end/routes/i/[id].tsx");
  test("the page asks for the card config on the server and mounts the island above the manual methods", () => {
    expect(route).toMatch(
      /ssrBackendGet<CardConfig>\(`\/invoices\/\$\{id\}\/card`\)/,
    );
    expect(route).toMatch(/<PublicCardPay/);
    expect(route).toMatch(/data-claim-wrap/);
    expect(route).toMatch(/paycard\.css/);
  });
  test("the widget's art ships with the app", () => {
    for (
      const f of [
        "chip.png",
        "visa.png",
        "mastercard.png",
        "amex.png",
        "discover.png",
      ]
    ) {
      expect(exists(`front-end/static/paycard/${f}`)).toBe(true);
    }
    expect(exists("front-end/static/paycard.css")).toBe(true);
    expect(read("front-end/static/paycard.css")).toMatch(
      /\.pc-card--active \.pc-card__side--front/,
    );
  });
  test("the words exist in both languages", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    for (
      const k of [
        "publicCardPay.heading",
        "publicCardPay.pay",
        "publicCardPay.paying",
        "publicCardPay.paid",
        "publicCardPay.paidBody",
        "publicCardPay.declined",
        "publicCardPay.number",
        "publicCardPay.holder",
        "publicCardPay.expiry",
        "publicCardPay.cvc",
        "publicCardPay.secure",
        "publicCardPay.or",
        "publicCardPay.err.number",
        "publicCardPay.err.holder",
        "publicCardPay.err.expiry",
        "publicCardPay.err.cvc",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
    }
  });
});

describe("REQ-213 the backend", () => {
  test("the public controller has the three card routes and the manual card chip is dropped while Stripe is on", () => {
    const ctrl = read(
      "backend/src/paperwork/entrypoints/public-controller/mod.ts",
    );
    expect(ctrl).toMatch(/@Get\("invoices\/:id\/card"\)/);
    expect(ctrl).toMatch(/@Post\("invoices\/:id\/card"\)/);
    expect(ctrl).toMatch(/@Post\("invoices\/:id\/card\/complete"\)/);
    expect(ctrl).toMatch(
      /acceptedMethods\.filter\(\(m\) => m\.method !== "card"\)/,
    );
  });
  test("a succeeded intent is recorded through the same path as the contractor's confirmation", () => {
    const rec = read(
      "backend/src/paperwork/domain/coordinators/record-card-payment/mod.ts",
    );
    expect(rec).toMatch(/this\.confirm\.run\(/);
    expect(rec).toMatch(/method: "card"/);
  });
});

describe("REQ-216 the CRM's widget, whole, with Stripe as its provider", () => {
  const island = read("front-end/islands/PublicCardPay.tsx");
  const css = read("front-end/static/paycard.css");
  test("the card prints per cell and animates the cells that changed; the ring glides; the number masks; the brand fades", () => {
    expect(island).toMatch(/numberCells\(/);
    expect(island).toMatch(/holderCells\(/);
    expect(island).toMatch(/changedCells\(/);
    expect(island).toMatch(/focusOutlineStyle\(/);
    expect(island).toMatch(/pc-card__numberItem/);
    expect(island).toMatch(/pc-card__nameItem/);
    expect(island).toMatch(/pc-card__focus/);
    expect(island).toMatch(/pc-anim-holder-fade-up/);
    expect(island).toMatch(/pc-anim-slide-fade-up/);
    expect(island).toMatch(/"animationend"/);
    expect(island).toMatch(/pc-fade-up/);
    expect(island).toMatch(/pc-card__bg/);
    expect(island).toMatch(/\/paycard\/backgrounds\/malachite\.jpg/);
    expect(island).toMatch(/markAnchorOf\(/);
    expect(island).toMatch(/markStyle\(/);
  });
  test("the form is the CRM's: tab-label fields whose label is the error, the one submit with a spinner, the secure line", () => {
    expect(island).toMatch(/pc-field-label/);
    expect(island).toMatch(/pc-field-label--error/);
    expect(island).toMatch(/pay-submit-spinner/);
    expect(island).toMatch(/publicCardPay\.secureCheckout/);
  });
  test("the gateway is a provider the island is configured with — stripe is the first entry", () => {
    expect(island).toMatch(/provider\??: "stripe"/);
    expect(island).toMatch(/PROVIDERS\s*[:=]/);
    expect(island).toMatch(/PROVIDERS\[/);
    const ctrl = read(
      "backend/src/paperwork/entrypoints/public-controller/mod.ts",
    );
    expect(ctrl).toMatch(/provider: "stripe"/);
  });
  test("the stylesheet carries the CRM's motion and the field; the clean art ships", () => {
    expect(css).toMatch(/@keyframes pc-slide-fade-up/);
    expect(css).toMatch(/@keyframes pc-holder-fade-up/);
    expect(css).toMatch(/@keyframes pc-fade /);
    expect(css).toMatch(/\.pc-card__focus--active/);
    expect(css).toMatch(/\.pc-card__brand\[data-anchor="right"\]/);
    expect(css).toMatch(/\.pc-field-label/);
    expect(css).toMatch(/\.pay-submit-spinner/);
    expect(exists("front-end/static/paycard/backgrounds/malachite.jpg")).toBe(
      true,
    );
    for (const f of ["paint", "triangles", "wood"]) {
      expect(exists(`front-end/static/paycard/backgrounds/${f}`)).toBe(false);
    }
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(typeof en["publicCardPay.secureCheckout"]).toBe("string");
    expect(typeof es["publicCardPay.secureCheckout"]).toBe("string");
  });
});
