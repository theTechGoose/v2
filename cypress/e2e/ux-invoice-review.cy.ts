/// <reference types="cypress" />

/**
 * UX audit (ux-problems.md) — invoice creation review + empty-state CSV reds.
 *
 * UX-31 [INVOICE] "The invoice is created and 'saved' without any review step,
 *   with a silent due date of TODAY. Facturar flow: price → customer →
 *   '¡Factura lista! 🎉 Quedó guardada' — the user never saw line items,
 *   description, or due date; the customer then receives an invoice that is
 *   already due the day it arrives."
 *   Grounded wiring: front-end/islands/AsstChat.tsx:3139-3145 — the facturar
 *   flow POSTs /invoices with `dueDate: today // job's done — due on receipt`
 *   and status "sent"; no review surface exists between the customer step and
 *   the success card. HONESTY notes:
 *     - The /invoices "Nueva factura" modal ALREADY has an editable due date
 *       defaulting +30 days (InvoicesPage.tsx:2331-2335,2538-2548) — green,
 *       not asserted.
 *     - POST /api/invoices with NO dueDate already defaults +30 days server-
 *       side (probed live: {"amount":50000,…} → dueDate 30 days out) — the
 *       backend half is green; the red is purely this FE path, so the tests
 *       DRIVE the real facturar flow (deterministic under the stub LLM: the
 *       details step is a local capture, no LLM call — AsstChat.tsx:2208-2225).
 *
 * UX-23 [INVOICES] "'Exportar CSV 2026' ghost button is near-invisible (pale
 *   pill on cream) and questionable on a zero-invoice empty state at all."
 *   Grounded: front-end/islands/InvoicesPage.tsx:753-762 — the export link
 *   keeps `.qph__cta`'s `color:#fff` (front-end/static/quotes.css:61-67) while
 *   its inline style flips the background transparent → white text over the
 *   cream page. Pinned: on a zero-invoice account the control is either not
 *   shown, or its text contrast against the effective background is ≥ 3.
 *
 * Flow selectors (grounded in front-end/islands/AsstChat.tsx and prior art
 * assistant-experience.cy.ts):
 *   starter chip     button.chat__empty-prompt  "Trabajo terminado, necesito
 *                    facturar." (asstChat.prompt.invoiceDone; startInvoiceFlow
 *                    :3061-3070)
 *   details input    textarea.composer__input + button.composer__send
 *                    (awaitingJobDetails → submitJobDetails :1578-1582,2208)
 *   price capture    .chat__price-capture / MoneyInput input.mi__input /
 *                    continue button .chat__price-continue (:4510-4534;
 *                    onPriceContinue → openInvoiceCustomerStep :1680-1689)
 *   customer step    CustomerStepPanel (:4390-4396) — 0 customers jumps to the
 *                    create form (:7254): name input .cust-create
 *                    input.cust-pick__search, phone input[type=tel], primary
 *                    .cust-create__btn--primary (:7341-7413)
 *   success card     asstChat.invoiceFlow.readyTitle "¡Factura lista! 🎉"
 *                    (:4263) — rendered TODAY with no review step in between.
 *
 * Phones (slice F block): UX-31 contractor +15125556510 (customer created in
 * the flow +15125556511); UX-23 contractor +15125556512.
 */

const FLOW_PHONE = "+15125556510";
const FLOW_CUSTOMER_PHONE = "+15125556511";
const CSV_PHONE = "+15125556512";

const CHIP_INVOICE_DONE = "Trabajo terminado, necesito facturar.";
const JOB_DETAILS = "Pintar la sala y el pasillo de la casa";

function loginEsFresh(phone: string) {
  cy.clearCookies();
  cy.loginAs(phone);
  cy.request({ url: "/api/me/wipe", failOnStatusCode: false });
  cy.loginAs(phone);
  cy.request("POST", "/api/me/onboarded", { skipped: true });
  cy.apiUpdateUser({ language: "es" });
  cy.clearCookie("pm_lang");
}

/** Drive the facturar flow up to (and including) the customer-step submit —
 *  the moment the app currently mints the due-today invoice. */
function driveFacturarToCustomerSubmit() {
  cy.visit("/assistant");
  cy.contains("button.chat__empty-prompt", CHIP_INVOICE_DONE)
    .should("be.visible")
    .click();
  cy.get("textarea.composer__input", { timeout: 10_000 })
    .should("be.visible")
    .type(JOB_DETAILS);
  cy.get("button.composer__send").click();
  // Price step (no LLM here — local capture): type the amount, continue.
  cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
  cy.get("input.mi__input").type("3700");
  cy.get(".chat__price-continue").should("not.be.disabled").click();
  // Customer step: the wiped account has zero customers, so the panel jumps
  // straight to the create form (AsstChat.tsx:7254).
  cy.get(".cust-create input.cust-pick__search", { timeout: 10_000 })
    .first()
    .type("María Nguyen");
  cy.get(".cust-create input[type=tel]").type(FLOW_CUSTOMER_PHONE);
  cy.get(".cust-create__btn--primary").should("not.be.disabled").click();
}

// ===========================================================================
// REQ-024 — NW-13 / NW-16 / NW-18 (p9, p12, p27): "if there is no quote to
// select, go through the same questions as the quote (skip how long it took,
// but ask for the completion date). Right now there is no preview, just
// 'Invoice ready 🎉 … Send it now'." Supersedes UX-31 (its editable-due-date
// review): the wizard's completion date + payment terms now DRIVE the due
// date, and the shared preview replaces the three-field card.
// ===========================================================================
describe("REQ-024 NW-13/18 a brand-new invoice runs the wizard and lands on the shared preview", () => {
  beforeEach(() => loginEsFresh(FLOW_PHONE));

  function pickFirstOption() {
    cy.get(".wiz__opts .wiz-opt:not(.wiz-opt--custom)", { timeout: 15_000 })
      .filter(":visible")
      .first()
      .click();
  }

  it("REQ-024 customer → completion date → payment → warranty → invoice preview → sent invoice linked to the agreement", () => {
    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", CHIP_INVOICE_DONE).should("be.visible").click();
    cy.get("textarea.composer__input", { timeout: 10_000 }).should("be.visible").type(JOB_DETAILS);
    cy.get("button.composer__send").click();
    cy.get(".chat__price-capture", { timeout: 10_000 }).should("be.visible");
    cy.get("input.mi__input").type("3700");
    cy.get(".chat__price-continue").should("not.be.disabled").click();

    // Customer step (wiped account → the create form).
    cy.get(".cust-create input.cust-pick__search", { timeout: 20_000 }).first().type("María Nguyen");
    cy.get(".cust-create input[type=tel]").type(FLOW_CUSTOMER_PHONE);
    cy.get(".cust-create__btn--primary").should("not.be.disabled").click();

    // Completion date — instead of "how long will the job take?".
    cy.contains(/cuándo se terminó el trabajo/i, { timeout: 20_000 }).should("be.visible");
    cy.contains(/cuánto tiempo tomará/i).should("not.exist");
    cy.get(".wiz__opts .wiz-opt").filter(":visible").then(($opts) => {
      const texts = [...$opts].map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());
      expect(texts, "completion-date options").to.deep.equal(["Hoy", "Ayer", "La semana pasada", "Elegir una fecha"]);
    });
    cy.contains(".wiz-opt", /^Hoy$/).click();

    // Payment terms — "Pago inmediato" (Due Now) → due on the completion date.
    cy.contains(".wiz-opt", /pago inmediato/i, { timeout: 15_000 }).click();
    // Warranty — any.
    pickFirstOption();

    // Same as the quote path: the end-of-wizard Job Details picker may open
    // first (three versions of the details) — apply it, then the preview.
    cy.get(".chat__jobopts, .quote-review", { timeout: 30_000 }).should("exist");
    cy.get("body").then(($b) => {
      if ($b.find(".chat__jobopts").length) {
        cy.get(".chat__jobopts .chat__price-continue").should("not.be.disabled").click();
      }
    });

    // The SHARED preview, in invoice mode.
    cy.get(".quote-review", { timeout: 20_000 }).should("be.visible");
    cy.get(".quote-review__langpill.is-active").should("contain.text", "Factura");
    cy.contains(/factura lista/i).should("not.exist");

    // Send it (email) from the preview.
    cy.contains("button", /enviar la factura/i, { timeout: 10_000 }).click();
    cy.get("[data-cy=send-keep]", { timeout: 10_000 }).click(); // REQ-035: Keep is the send

    const today = new Date().toISOString().slice(0, 10);
    cy.request("/api/invoices").its("body").then((rows: Array<{ id: string; quoteId?: string; dueDate?: string; createdAt?: string; lineItems?: unknown[] }>) => {
      const newest = [...rows].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))[0];
      expect(newest?.quoteId, "invoice linked to the agreement").to.be.a("string").and.not.empty;
      expect(newest?.dueDate, "Due Now + completed today → due today").to.eq(today);
      cy.wrap(newest.id).as("invoiceId");
    });
    cy.get("@invoiceId").then((id) => {
      cy.clearCookies();
      cy.visit(`/i/${id}`);
      cy.get(".ctr__terms-grid", { timeout: 20_000 }).should("exist");
    });
  });
});

// ---------------------------------------------------------------------------
// UX-23 — empty-state "Exportar CSV" must be visible-or-gone, never a ghost
// ---------------------------------------------------------------------------

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseCssColor(raw: string): Rgb | null {
  const m = raw.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/,
  );
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastRatio(fg: Rgb, bg: Rgb): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** First non-transparent ancestor background-color (the button itself is
 *  `background:transparent` per its inline style, InvoicesPage.tsx:757). */
function effectiveBackground(el: HTMLElement): Rgb {
  let node: HTMLElement | null = el;
  const win = el.ownerDocument.defaultView as Window;
  while (node) {
    const c = parseCssColor(win.getComputedStyle(node).backgroundColor);
    if (c && c.a > 0) return c;
    node = node.parentElement;
  }
  return { r: 255, g: 255, b: 255, a: 1 }; // document default
}

describe("UX-23: empty-state 'Exportar CSV' is not a near-invisible ghost", () => {
  it("UX-23: with zero invoices the export control is hidden or ≥3:1 contrast", () => {
    loginEsFresh(CSV_PHONE);
    cy.visit("/invoices");
    // Hero rendered (fix-independent marker: the primary new-invoice CTA).
    cy.get("[data-cy=invoice-new]", { timeout: 10_000 }).should("be.visible");
    cy.get("body").then(($body) => {
      const $export = $body.find("[data-cy=invoice-export]");
      if ($export.length === 0 || !$export.is(":visible")) {
        // Acceptable fix: the control is simply not offered on an account
        // with nothing to export.
        return;
      }
      const el = $export[0] as HTMLElement;
      const win = el.ownerDocument.defaultView as Window;
      const fg = parseCssColor(win.getComputedStyle(el).color);
      expect(fg, "export control text color parses").to.not.eq(null);
      const bg = effectiveBackground(el);
      const ratio = contrastRatio(fg as Rgb, bg);
      // RED today: `.qph__cta` keeps color:#fff (quotes.css:67) while the
      // inline style strips the pink background (InvoicesPage.tsx:757) —
      // white-on-cream lands far below 3:1.
      expect(
        ratio,
        `export CSV text contrast (${ratio.toFixed(2)}:1) is at least 3:1`,
      ).to.be.gte(3);
    });
  });
});

// Module scope: keeps top-level declarations out of the shared global
// script scope the spec files otherwise compile into.
export {};

// ===========================================================================
// REQ-023 — NW-14 / NW-15 (p10, p11): "If you select the invoice of an
// existing client, the next page must show what they paid, what they owe,
// the terms, etc." / "If I select an existing quote it should already know
// who the customer is." Picking an accepted job must skip the price and
// customer questions and land on a review seeded from the quote; the saved
// invoice links the quote.
// ===========================================================================
describe("REQ-023 NW-14/15 invoice from an accepted quote", () => {
  const PHONE = "+15125556513";
  const JOB = "Patio de adoquines";

  beforeEach(() => loginEsFresh(PHONE));

  it("REQ-023 the accepted-job chip skips price + customer and lands on a seeded review; the saved invoice links the quote", () => {
    cy.apiCreateCustomer({
      name: "María Nguyen",
      email: "maria.req023@blackhole.postmarkapp.com",
      phoneNumber: "+15125556514",
    }).then((customerId: string) => {
      cy.apiCreateQuote({
        customerId,
        summary: JOB,
        jobName: JOB,
        description: "Nivelar, colocar adoquines y sellar",
        lineItems: [{ description: "Adoquines", quantity: 1, unit: "job", price: 120000 }],
        estimatedTotal: 120000,
        terms: [{ stepId: "payment_terms", label: "Términos de pago", value: "50 / 50" }],
      }).then((quoteId: string) => {
        cy.apiAcceptQuote(quoteId, { signature: "María Nguyen", name: "María Nguyen" });
        cy.wrap(quoteId).as("quoteId");
      });
    });

    cy.visit("/assistant");
    cy.contains("button.chat__empty-prompt", CHIP_INVOICE_DONE).should("be.visible").click();
    cy.get(".chat__accepted-job", { timeout: 15_000 }).first().click();

    // Never asks for the price or the customer again.
    cy.contains("¿Cuál es el precio?").should("not.exist");
    cy.get(".cust-create, .cust-pick").should("not.exist");

    // The review already knows the job, the customer, the total, and the money so far.
    cy.get("[data-cy=invoice-quote-summary]", { timeout: 15_000 })
      .should("be.visible")
      .and("contain.text", JOB)
      .and("contain.text", "María Nguyen")
      .and("contain.text", "1,200");
    cy.get("[data-cy=invoice-billed-so-far]").should("exist");
    cy.get("[data-cy=invoice-paid-so-far]").should("exist");

    cy.get("[data-cy=invoice-flow-save]").click();
    cy.get("@quoteId").then((quoteId) => {
      cy.request("/api/invoices").its("body").should((rows: Array<{ quoteId?: string; createdAt?: string; lineItems?: unknown[] }>) => {
        const newest = [...rows].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))[0];
        expect(newest.quoteId, "invoice linked to the accepted quote").to.eq(String(quoteId));
        expect(newest.lineItems?.length ?? 0, "line items carried over").to.be.greaterThan(0);
      });
    });
  });
});
