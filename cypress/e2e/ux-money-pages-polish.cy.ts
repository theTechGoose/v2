/// <reference types="cypress" />

/**
 * UX audit (ux-problems.md) — UX-35 PAGES bullets (the assistant bullets of
 * UX-35 belong to slice E; the /q "una sola línea" agreement half is pinned in
 * jest/unit/ux-page-copy.test.ts).
 *
 * UX-35 [/payments] "hero chip 'PAGOS · AUGUST' — English month in the ES UI."
 *   Grounded: front-end/islands/PaymentsPage.tsx:472 —
 *   `new Date().toLocaleString("en-US", { month: "long" })` interpolated into
 *   paymentsPage.hero.eyebrow "Pagos · {month}" (.pph__eyebrow, :477-480).
 *
 * UX-35 [/i] "after claiming: header badge stays 'PENDIENTE' (no visible state
 *   change) and the footer still asks '¿Preguntas antes de pagar?'."
 *   Grounded: the badge (StatusPill, front-end/routes/i/[id].tsx:243-248,
 *   599-605 — ES publicInvoice.status.due "Pendiente") and the footer
 *   (publicInvoice.footer.questions, :463) are SSR-static, OUTSIDE the
 *   PublicInvoiceClaim island — the island only swaps its own section to the
 *   thanks card (PublicInvoiceClaim.tsx:62-80), so an in-page claim leaves
 *   both stale until a manual reload (the reload path already renders
 *   "En confirmación" + ClaimedNote, routes/i/[id].tsx:581-588,620-658).
 *
 * UX-35 [/settings] "renders the same fields twice (read-only 'Cuenta'/
 *   'Identidad' cards + an 'Edita tus datos' form below); long email value
 *   clips at the card edge."
 *   Grounded: front-end/islands/SettingsPage.tsx:1552-1576 (read-only <Card>
 *   pair showing name/phone/EMAIL/language + business fields) followed by
 *   :1578 <EditCard> ("Edita tus datos", settings.editDetails) repeating
 *   name/email/businessName as inputs (:344-374). The email value cell is a
 *   plain grid <div> (:210-218) with no overflow handling.
 *
 * UX-35 [/clients] "giant translucent '0' watermark on the client card."
 *   Grounded: sinceBadge(days≤0) returns num "0"
 *   (front-end/lib/clients-display.ts:123-125) which renders as the 96px
 *   translucent watermark .ccard2__since-num
 *   (front-end/islands/ClientsBoard.tsx:58-65,
 *   front-end/static/clients.css:87-90). Pinned: a just-contacted client's
 *   badge never shows the bare numeral "0" (the unit "HOY" tells the story).
 *   HONESTY — the "SALDO / Saldado reads clunky" half is DROPPED: any
 *   replacement wording would be an arbitrary copy choice, not a measurable
 *   contract.
 *
 * UX-35 [preview] "the TOTAL / 'Estimated:' rows show a pinkish selected/
 *   edit-state tint without user interaction."
 *   Grounded: the tint is the edit-affordance style rgba(255,107,107,…) —
 *   front-end/static/assistant-page.css:6490-6497 (.quote-review__editable
 *   :hover/:focus) and the term buttons (.quote-review__term-edit, :6585+);
 *   NO resting-state rule paints it, so in a sterile session this may already
 *   hold — LABELED RESTING-STATE GUARD (possibly green): it pins the audited
 *   invariant (no tint without interaction) without inventing a trigger.
 *
 * Preview drive (prior art assistant-experience.cy.ts P-26): /assistant?dev →
 * .chat__empty-debug-btn (seedPhase2) → customer step → 4× first wizard
 * option → .quote-review.
 *
 * Phones (slice F block): /payments +15125556530; /i contractor +15125556531,
 * customer +15125556532; /settings +15125556533; /clients contractor
 * +15125556534, customer +15125556535; preview user +15125556536.
 */

const PAYMENTS_PHONE = "+15125556530";
const INVOICE_PHONE = "+15125556531";
const INVOICE_CUSTOMER_PHONE = "+15125556532";
const SETTINGS_PHONE = "+15125556533";
const CLIENTS_PHONE = "+15125556534";
const CLIENTS_CUSTOMER_PHONE = "+15125556535";
const PREVIEW_PHONE = "+15125556536";

const ES_MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const EN_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function loginEsFresh(phone: string) {
  cy.clearCookies();
  cy.loginAs(phone);
  cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
  cy.loginAs(phone);
  cy.request("POST", "/api/me/onboarded", { skipped: true });
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang");
}

describe("UX-35: /payments hero chip month is localized in ES", () => {
  it("UX-35: the eyebrow shows the Spanish month, not the English one", () => {
    loginEsFresh(PAYMENTS_PHONE);
    cy.visit("/payments");
    cy.get(".pph__eyebrow", { timeout: 10_000 }).should("be.visible")
      .invoke("text")
      .then((raw) => {
        const text = String(raw).toLowerCase();
        const m = new Date().getMonth();
        // RED today: PaymentsPage.tsx:472 hardcodes toLocaleString("en-US").
        expect(text, `eyebrow ("${String(raw).trim()}") uses the ES month`).to
          .contain(ES_MONTHS[m]);
        expect(text, "eyebrow drops the English month").to.not.contain(
          EN_MONTHS[m],
        );
      });
  });
});

describe("UX-35: /i reflects the claim without a manual reload", () => {
  it("UX-35: after claiming, the badge leaves 'Pendiente' and the footer adapts", () => {
    cy.clearCookies();
    cy.loginAs(INVOICE_PHONE);
    cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
    cy.loginAs(INVOICE_PHONE);
    cy.request("POST", "/api/me/onboarded", { skipped: true });
    // Claim chips render only when the contractor accepts a method
    // (public-money-pages-i18n.cy.ts precedent).
    cy.apiUpdateProfile({
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "pagos.ux35@blackhole.postmarkapp.com" },
      },
    });
    cy.apiCreateCustomer({
      name: "María Nguyen",
      email: "maria.ux35@blackhole.postmarkapp.com",
      phoneNumber: INVOICE_CUSTOMER_PHONE,
    }).then((customerId: string) =>
      cy.apiCreateInvoice({
        customerId,
        amount: 370_000,
        dueDate: "2099-01-01",
        status: "sent",
        jobName: "Patio de adoquines",
      })
    ).then((invoiceId: string) => {
      // Customer side, Spanish chrome.
      cy.clearCookies();
      cy.setCookie("pm_lang", "es");
      cy.visit(`/i/${invoiceId}`);
      // Pre-claim sanity: the "Pendiente" pill and the pre-pay footer render.
      cy.contains("Pendiente", { timeout: 10_000 }).should("be.visible");
      cy.contains("¿Preguntas antes de pagar?").should("be.visible");

      // Drive the in-page claim (PublicInvoiceClaim island).
      cy.get("[data-cy=claim-method-zelle]").click();
      cy.get("[data-cy=claim-submit]").should("be.visible").click();
      cy.get("[data-cy=claim-thanks]", { timeout: 10_000 }).should(
        "be.visible",
      );

      // RED today: the SSR badge outside the island still says "Pendiente"
      // (routes/i/[id].tsx:599-605) — no visible state change on the page
      // header until a manual reload.
      cy.contains(/^\s*Pendiente\s*$/).should("not.exist");
      // RED today: the footer still invites pre-payment questions
      // (routes/i/[id].tsx:463) after the customer just said they paid.
      cy.get("body").invoke("text").should(
        "not.contain",
        "¿Preguntas antes de pagar?",
      );
    });
  });
});

describe("UX-35: /settings shows each identity field on ONE surface, unclipped", () => {
  const LONG_EMAIL =
    "cuenta.de.correo.superlarga.para.pruebas.ux35@blackhole.postmarkapp.com";

  beforeEach(() => {
    loginEsFresh(SETTINGS_PHONE);
    cy.apiUpdateUser({ name: "Rafael Prueba", email: LONG_EMAIL });
    cy.apiUpdateProfile({ businessName: "Techos Prueba" });
    cy.visit("/settings");
    cy.contains("Edita tus datos", { timeout: 10_000 }).should("be.visible");
  });

  it("UX-35: the account email is not rendered twice as independent surfaces", () => {
    // RED today: the read-only "Cuenta" card prints the email as text
    // (SettingsPage.tsx:1553-1563) AND the "Edita tus datos" form repeats it
    // as an input value (:361-374) — two competing surfaces for one field.
    cy.get("body").then(($body) => {
      const textCount = $body.text().split(LONG_EMAIL).length - 1;
      const inputCount = $body
        .find("input")
        .filter((_, el) => (el as unknown as HTMLInputElement).value === LONG_EMAIL)
        .length;
      expect(
        textCount + inputCount,
        `occurrences of the account email on /settings (text ${textCount} + inputs ${inputCount})`,
      ).to.be.at.most(1);
    });
  });

  it("UX-35: a long email value does not clip at the card edge", () => {
    // RED today: the read-only value cell is a bare grid <div>
    // (SettingsPage.tsx:210-218) — an unbroken email overflows and clips.
    // The check targets every element that renders the email as its OWN text
    // (post-fix states with the email only inside an input pass vacuously —
    // inputs scroll internally by design).
    cy.get("body").then(($body) => {
      const holders = $body.find("*").filter((_, el) =>
        Array.from(el.childNodes).some((n) =>
          n.nodeType === 3 && (n.textContent ?? "").includes(LONG_EMAIL)
        )
      );
      holders.each((_, el) => {
        expect(
          el.scrollWidth,
          `email holder <${el.tagName.toLowerCase()}> does not overflow (scroll ${el.scrollWidth} ≤ client ${el.clientWidth})`,
        ).to.be.at.most(el.clientWidth + 2);
      });
    });
  });
});

describe("UX-35: /clients card — no giant translucent '0' watermark", () => {
  it("UX-35: a just-contacted client's since-badge never shows a bare '0'", () => {
    loginEsFresh(CLIENTS_PHONE);
    cy.apiCreateCustomer({
      name: "Laura Ortiz",
      email: "laura.ux35@blackhole.postmarkapp.com",
      phoneNumber: CLIENTS_CUSTOMER_PHONE,
    }).then((customerId: string) => {
      // A quote so the analytics card renders reliably
      // (clients-page-quality.cy.ts precedent).
      cy.apiCreateQuote({
        customerId,
        summary: "Pintura interior",
        jobName: "Pintura Interior",
        lineItems: [
          { description: "Pintura", quantity: 1, unit: "ea", price: 90_000 },
        ],
        estimatedTotal: 90_000,
      });
    });
    cy.visit("/clients");
    cy.get(".ccard2", { timeout: 10_000 }).should("have.length.at.least", 1);
    // RED today: sinceBadge(0) → num "0" (clients-display.ts:123-125) → the
    // 96px translucent "0" dominates the card art for a day-0 client.
    cy.get(".ccard2__since-num").first().invoke("text").then((t) => {
      expect(String(t).trim(), "day-0 since-badge numeral is not a bare '0'")
        .to.not.eq("0");
    });
  });
});

describe("UX-35: preview TOTAL/Estimated rows carry no edit-state tint at rest", () => {
  function pickFirstOption() {
    cy.get(".wiz__opts .wiz-opt:not(.wiz-opt--custom)", { timeout: 15_000 })
      .filter(":visible")
      .first()
      .click();
  }

  it("UX-35: [RESTING-STATE GUARD — possibly green] no pink edit tint without interaction", () => {
    // The audit measured a pinkish tint on these rows with NO interaction;
    // per source the pink rgba(255,107,107,…) exists only as the
    // hover/focus edit affordance (assistant-page.css:6490-6497). This guard
    // pins the resting state; it cannot reproduce the audit's (unknown,
    // state-dependent) trigger, so it may already pass in a sterile run —
    // labeled per the honesty rules rather than faking a red.
    loginEsFresh(PREVIEW_PHONE);
    cy.visit("/assistant?dev");
    cy.get(".chat__empty-debug-btn", { timeout: 10_000 })
      .should("be.visible")
      .click();
    cy.location("pathname", { timeout: 20_000 })
      .should("match", /^\/assistant\/[A-Za-z0-9_-]+$/);
    cy.openCustomerCreateForm();
    cy.get(".cust-create input.cust-pick__search", { timeout: 20_000 })
      .first()
      .type("Cliente Tinte");
    cy.get(".cust-create input[type=email]").type(
      "tinte.ux35@blackhole.postmarkapp.com",
    );
    cy.get(".cust-create__btn--primary").should("not.be.disabled").click();
    pickFirstOption();
    pickFirstOption();
    pickFirstOption();
    pickFirstOption();
    cy.get(".quote-review", { timeout: 20_000 }).should("be.visible");

    const PINK = /255,\s*107,\s*107/;
    cy.get(".quote-review__total-num").then(($el) => {
      const bg = ($el[0].ownerDocument.defaultView as Window)
        .getComputedStyle($el[0]).backgroundColor;
      expect(bg, `TOTAL value resting background (${bg}) is not the edit tint`)
        .to.not.match(PINK);
    });
    cy.get(".quote-review__term-edit").first().then(($el) => {
      const bg = ($el[0].ownerDocument.defaultView as Window)
        .getComputedStyle($el[0]).backgroundColor;
      expect(bg, `term row resting background (${bg}) is not the edit tint`)
        .to.not.match(PINK);
    });
  });
});

// Module scope: keeps top-level declarations out of the shared global
// script scope the spec files otherwise compile into.
export {};
